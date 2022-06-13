// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import session from 'koa-session'
import { ADMIN_URI, BUILD_TIMESTAMP, DEV, FORBIDDEN, SESSION_DURATION } from './const'
import Application from 'koa'
import { FRONTEND_URI } from './const'
import { cantReadStatusCode, hasPermission, nodeIsDirectory, urlToNode } from './vfs'
import { dirTraversal } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFileNode } from './serveFile'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { Readable } from 'stream'
import { applyBlock } from './block'
import { getAccount, getCurrentUsername } from './perm'
import { socket2connection, updateConnection, normalizeIp } from './connections'

export const gzipper = compress({
    threshold: 2048,
    gzip: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    deflate: { flush: require('zlib').constants.Z_SYNC_FLUSH },
    br: false, // disable brotli
    filter(type) {
        return /text|javascript|style/i.test(type)
    },
})

export const headRequests: Koa.Middleware = async (ctx, next) => {
    const head = ctx.method === 'HEAD'
    if (head)
        ctx.method = 'GET' // let other middlewares work, so we can collect the size at the end
    await next()
    if (!head || ctx.body === undefined) return
    const { length, status } = ctx.response
    if (ctx.body)
        ctx.body = Readable.from('') // empty the body for this is a HEAD request. Using Readable avoids koa from trying to set length to 0
    ctx.status = status
    if (length)
        ctx.response.length = length
}

export const sessions = (app: Application) => session({
    key: 'hfs_$id',
    signed: true,
    rolling: true,
    maxAge: SESSION_DURATION,
}, app)

const serveFrontendFiles = serveGuiFiles(process.env.FRONTEND_PROXY, FRONTEND_URI)
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontendFiles)
const serveAdminPrefixed = mount(ADMIN_URI.slice(0,-1), serveGuiFiles(process.env.ADMIN_PROXY, ADMIN_URI))

export const serveGuiAndSharedFiles: Koa.Middleware = async (ctx, next) => {
    const { path } = ctx
    if (ctx.body)
        return next()
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path+'/' === ADMIN_URI)
        return ctx.redirect(ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return serveAdminPrefixed(ctx,next)
    const node = await urlToNode(path, ctx)
    if (!node)
        return ctx.status = 404
    const cantRead = !hasPermission(node, 'can_read', ctx)
    const isFolder = await nodeIsDirectory(node)
    if (!cantRead && !isFolder)
        return node.source ? serveFileNode(node)(ctx,next)
            : next()
    ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
    if (cantRead) {
        ctx.status = cantReadStatusCode(node)
        if (ctx.status === FORBIDDEN)
            return
        // this folder was requested without the trailing / and we may still log in
        if (isFolder && !path.endsWith('/') && !ctx.state.account)
            return ctx.redirect(path + '/')
        return serveFrontendFiles(ctx, next)
    }
    const { get } = ctx.query
    if (get === 'zip')
        return await zipStreamFromFolder(node, ctx)
    if (node.default) {
        const def = await urlToNode(path + node.default, ctx)
        return !def ? next()
            : hasPermission(def, 'can_read', ctx) ? serveFileNode(def)(ctx, next)
            : ctx.status = cantReadStatusCode(def)
    }
    return serveFrontendFiles(ctx, next)
}

let proxyDetected = false
export const someSecurity: Koa.Middleware = async (ctx, next) => {
    ctx.request.ip = normalizeIp(ctx.ip)
    try {
        let proxy = ctx.get('X-Forwarded-For')
        // we have some dev-proxies to ignore
        if (DEV && proxy && [process.env.FRONTEND_PROXY, process.env.ADMIN_PROXY].includes(ctx.get('X-Forwarded-port')))
            proxy = ''
        if (dirTraversal(decodeURI(ctx.path)))
            return ctx.status = 418
        if (applyBlock(ctx.socket, ctx.ip))
            return
        proxyDetected ||= proxy > ''
        ctx.state.proxiedFor = proxy
    }
    catch {
        return ctx.status = 418
    }
    return next()
}

// this is only about http proxies
export function getProxyDetected() {
    return proxyDetected
}
export const prepareState: Koa.Middleware = async (ctx, next) => {
    // calculate these once and for all
    ctx.state.account = getAccount(getCurrentUsername(ctx))
    const conn = ctx.state.connection = socket2connection(ctx.socket)
    if (conn)
        updateConnection(conn, { ctx })
    await next()
}

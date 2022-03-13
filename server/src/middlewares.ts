// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import session from 'koa-session'
import { ADMIN_URI, BUILD_TIMESTAMP, FORBIDDEN, SESSION_DURATION } from './const'
import Application from 'koa'
import { FRONTEND_URI } from './const'
import { cantReadStatusCode, hasPermission, urlToNode } from './vfs'
import { dirTraversal, isDirectory } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFileNode } from './serveFile'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { Readable } from 'stream'
import { getAccount, getCurrentUsername } from './perm'
import { getConfig, subscribeConfig } from './config'
import { getConnections, socket2connection, updateConnection } from './connections'
import { Socket } from 'net'
import { isMatch } from 'micromatch'

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
    const allowedRef = getConfig('allowed_referer')
    if (allowedRef) {
        const ref = /\/\/([^:/]+)/.exec(ctx.get('referer'))?.[1] // extract host from url
        if (ref && ref !== ctx.get('host')?.split(':')[0] // automatic accept if referer is basically the hosting domain
            && !isMatch(ref, allowedRef))
            return ctx.status = FORBIDDEN
    }
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path+'/' === ADMIN_URI)
        return ctx.redirect(ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return serveAdminPrefixed(ctx,next)
    const node = await urlToNode(path, ctx)
    if (!node)
        return next()
    if (!hasPermission(node, 'can_read', ctx))
        return ctx.status = cantReadStatusCode(node)
    const { source } = node
    if (!source || await isDirectory(source)) {
        const { get } = ctx.query
        if (get === 'zip')
            return await zipStreamFromFolder(node, ctx)
        if (!path.endsWith('/')) // this folder was requested without the trailing /
            return ctx.redirect(path + '/')
        if (node.default) {
            const def = await urlToNode(path + node.default, ctx)
            return !def ? next()
                : hasPermission(def, 'can_read', ctx) ? serveFileNode(def)(ctx, next)
                : ctx.status = cantReadStatusCode(def)
        }
        ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
        return serveFrontendFiles(ctx, next)
    }
    if (source)
        return serveFileNode(node)(ctx,next)
    return next()
}

export const someSecurity: Koa.Middleware = async (ctx, next) => {
    try {
        if (dirTraversal(decodeURI(ctx.path)))
            return ctx.status = 418
        if (applyBlock(ctx.socket))
            return
    }
    catch {
        return ctx.status = 418
    }
    return next()
}

subscribeConfig({ k: 'block', defaultValue: [] }, () => {
    for (const { socket } of getConnections())
        applyBlock(socket)
})

function applyBlock(socket: Socket) {
    if (getConfig('block').find((rule:any) => rule.ip === socket.remoteAddress))
        return socket.destroy()
}

export const prepareState: Koa.Middleware = async (ctx, next) => {
    // calculate these once and for all
    ctx.state.account = getAccount(getCurrentUsername(ctx))
    const conn = ctx.state.connection = socket2connection(ctx.socket)
    if (conn?.path) // leftover of connection reused for a new request
        updateConnection(conn, { path: '' })
    await next()
}

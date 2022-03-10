// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import session from 'koa-session'
import { BUILD_TIMESTAMP, SESSION_DURATION } from './const'
import Application from 'koa'
import { FRONTEND_URI } from './const'
import { cantReadStatusCode, hasPermission, urlToNode } from './vfs'
import { dirTraversal, isDirectory } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFileNode } from './serveFile'
import { serveFrontend } from './serveFrontend'
import mount from 'koa-mount'
import { Readable } from 'stream'
import { getAccount, getCurrentUsername, getCurrentUsernameExpanded } from './perm'
import { getConfig, subscribeConfig } from './config'
import { getConnections } from './connections'
import { Socket } from 'net'

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

// serve shared files and front-end files
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontend)

export const frontendAndSharedFiles: Koa.Middleware = async (ctx, next) => {
    const { path } = ctx
    if (ctx.body)
        return next()
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
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
        return serveFrontend(ctx, next)
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

export function prepareState(admin=false): Koa.Middleware {
    return async (ctx, next) => {
        ctx.state.usernames = getCurrentUsernameExpanded(ctx) // accounts chained via .belongs for permissions check
        ctx.state.account = getAccount(getCurrentUsername(ctx))
        ctx.state.admin = admin
        if (admin)
            ctx.state.accountIsAdmin = ctx.state.usernames.some((u:string) => getAccount(u)?.admin)
        await next()
    }
}

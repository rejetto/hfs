import compress from 'koa-compress'
import Koa from 'koa'
import session from 'koa-session'
import { BUILD_TIMESTAMP, SESSION_DURATION } from './index'
import Application from 'koa'
import { FORBIDDEN, FRONTEND_URI } from './const'
import { vfs } from './vfs'
import { isDirectory } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFileNode } from './serveFile'
import { serveFrontend } from './serveFrontend'
import mount from 'koa-mount'
import { Readable } from 'stream'

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
        ctx.method = 'GET' // let's other middleware work so we can collect the size at the end
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
    if (path.includes('..'))
        ctx.throw(500)
    if (ctx.body)
        return next()
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    const decoded = decodeURI(path)
    const node = await vfs.urlToNode(decoded, ctx)
    if (!node)
        return next()
    const { source } = node
    if (node.forbid)
        return ctx.status = FORBIDDEN
    if (!source || await isDirectory(source)) {
        const { get } = ctx.query
        if (get === 'zip')
            return await zipStreamFromFolder(node, ctx)
        if (!path.endsWith('/')) // this folder was requested without the trailing /
            return ctx.redirect(path + '/')
        if (node.default) {
            const def = await vfs.urlToNode(decoded + node.default, ctx)
            if (def)
                return serveFileNode(def)(ctx, next)
        }
        ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
        return serveFrontend(ctx, next)
    }
    if (source)
        return serveFileNode(node)(ctx,next)
    return next()
}

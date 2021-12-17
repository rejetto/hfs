import proxy from 'koa-better-http-proxy'
import Koa from 'koa'
import MemoMap from './MemoMap'
import mime from 'mime-types'
import { readFile } from 'fs'
import { DEV, FRONTEND_URI } from './const'

const FRONTEND = __dirname + '/frontend/'

export const serveFrontend = DEV ? serveProxyFrontend() : serveStaticFrontend()

function serveProxyFrontend() {
    console.debug('fronted: proxied')
    return proxy('localhost:3000', {
        proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
        userResDecorator: (res, data) => replaceFrontEndRes(data.toString('utf8'))
    })
}

function serveStaticFrontend() : Koa.Middleware {
    console.debug('fronted: static')
    const cache = new MemoMap()
    return async (ctx, next) => {
        let file = ctx.path
        if (file.startsWith('/'))
            file = file.slice(1)
        ctx.body = await cache.getOrSet(file, () =>
            filePromise(FRONTEND + (file || 'index.html')).then(res =>
                replaceFrontEndRes(res.toString('utf8')) ))
        ctx.type = file ? (mime.lookup(file) || 'application/octet-stream') : 'html'
        await next()
    }
}

function filePromise(path: string) : Promise<Buffer> {
    return new Promise((resolve, reject) =>
        readFile(path, (err,res) =>
            err ? reject(err) : resolve(res) ))
}

function replaceFrontEndRes(body: string) {
    return body.replace(/((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1'+FRONTEND_URI)
}

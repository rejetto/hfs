import proxy from 'koa-better-http-proxy'
import Koa from 'koa'
import mime from 'mime-types'
import { createReadStream, readFile } from 'fs'
import { DEV, FRONTEND_URI } from './const'

export const serveFrontend = DEV ? serveProxyFrontend() : serveStaticFrontend()

function serveProxyFrontend() {
    console.debug('fronted: proxied')
    return proxy('localhost:3000', {
        proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
        userResDecorator: (res, data, req) => {
            return req.url.endsWith('/') ? replaceFrontEndRes(data.toString('utf8'))
                : data
        }
    })
}

function serveStaticFrontend() : Koa.Middleware {
    const BASE = __dirname + (DEV ? '/../dist' : '') + '/frontend/'
    return async (ctx, next) => {
        let { path } = ctx
        if (path.endsWith('/')) {
            const res = await filePromise(BASE + 'index.html')
            ctx.body = replaceFrontEndRes(res.toString('utf8'))
            ctx.type = 'html'
        } else {
            ctx.body = createReadStream(BASE + path.slice(1))
            ctx.type = mime.lookup(path) || 'application/octet-stream'
        }
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

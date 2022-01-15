import proxy from 'koa-better-http-proxy'
import Koa from 'koa'
import fs from 'fs/promises'
import { DEV, FRONTEND_URI, METHOD_NOT_ALLOWED, NO_CONTENT, PLUGINS_PUB_URI } from './const'
import { serveFile } from './serveFile'
import { mapPlugins } from './plugins'

export const serveFrontend = DEV ? serveProxyFrontend() : serveStaticFrontend()

function serveProxyFrontend() {
    console.debug('fronted: proxied')
    return proxy('localhost:3000', {
        filter: ctx => ctx.method === 'GET' || (ctx.status = METHOD_NOT_ALLOWED) && false,
        proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
        userResDecorator: (res, data, req) => {
            return req.url.endsWith('/') ? treatIndex(data.toString('utf8'))
                : data
        }
    })
}

function serveStaticFrontend() : Koa.Middleware {
    const BASE = __dirname + (DEV ? '/../dist' : '') + '/frontend/'
    return async (ctx, next) => {
        let { path, method } = ctx
        if (method === 'OPTIONS') {
            ctx.status = NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (method !== 'GET')
            return ctx.status = METHOD_NOT_ALLOWED
        if (path.endsWith('/')) { // we don't cache the index as it's small and may prevent plugins change to apply
            ctx.body = treatIndex(String(await fs.readFile(BASE + 'index.html')))
            ctx.type = 'html'
        } else {
            const fullPath = BASE + path.slice(1)
            const modifier = path.includes('static/js') ? // webpack
                (s:string) => s.replace(/(return")(static\/)/g, '$1' + FRONTEND_URI.substring(1) + '$2')
                : undefined
            return serveFile(fullPath, 'auto', modifier)(ctx, next)
        }
        await next()
    }
}

function replaceFrontEndRes(body: string) {
    return body.replace(/((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1'+FRONTEND_URI)
}

function treatIndex(body: string) {
    return replaceFrontEndRes(body)
        // replacing this text allow us to avoid injecting in frontends that don't support plugins. Don't use a <--comment--> or it will be removed by webpack
        .replace('_HFS_PLUGINS_', pluginsInjection)
}

function pluginsInjection() {
    const css = mapPlugins((plug,k) =>
        plug.frontend_css?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
    const js = mapPlugins((plug,k) =>
        plug.frontend_js?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
    return css.map(uri => `\n<link rel='stylesheet' type='text/css' href='${uri}'/>`).join('')
        + js.map(uri => `\n<script defer src='${uri}'></script>`).join('')
}

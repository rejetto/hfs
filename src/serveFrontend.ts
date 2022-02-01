import Koa from 'koa'
import fs from 'fs/promises'
import { FRONTEND_URI, METHOD_NOT_ALLOWED, NO_CONTENT, PLUGINS_PUB_URI } from './const'
import { serveFile } from './serveFile'
import { mapPlugins } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apis'

function serveProxyFrontend(port?: string) { // used for development
    if (!port)
        return
    console.debug('fronted: proxied')
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib =>
        proxy = lib.default('localhost:'+port, {
            filter: ctx => ctx.method === 'GET' || (ctx.status = METHOD_NOT_ALLOWED) && false,
            proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
            userResDecorator(res, data, ctx) {
                return ctx.url.endsWith('/') ? treatIndex(ctx, data.toString('utf8'))
                    : data
            }
        })
    )
    return function() { //@ts-ignore
        return proxy.apply(this,arguments)
    }
}

const serveStaticFrontend : Koa.Middleware =  async (ctx, next) => {
    const BASE = 'frontend/'
    let { path, method } = ctx
    if (method === 'OPTIONS') {
        ctx.status = NO_CONTENT
        ctx.set({ Allow: 'OPTIONS, GET' })
        return
    }
    if (method !== 'GET')
        return ctx.status = METHOD_NOT_ALLOWED
    if (path.endsWith('/')) { // we don't cache the index as it's small and may prevent plugins change to apply
        ctx.body = await treatIndex(ctx, String(await fs.readFile(BASE + 'index.html')))
        ctx.type = 'html'
        ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    } else {
        const fullPath = BASE + path.slice(1)
        const modifier = path.includes('static/js') ? // webpack
            (s:string) => s.replace(/(return")(static\/)/g, '$1' + FRONTEND_URI.substring(1) + '$2')
            : undefined
        return serveFile(fullPath, 'auto', modifier)(ctx, next)
    }
    await next()
}

function serveAdminProxy(port?: string) { // used for development
    if (!port)
        return
    console.debug('admin: proxied')
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib =>
        proxy = lib.default('localhost:'+port, {}) )
    return function() { //@ts-ignore
        return proxy.apply(this,arguments)
    }
}

const serveAdminStatic : Koa.Middleware  = async (ctx, next) => {
    const fullPath = 'admin' + (ctx.path.includes('.') ? ctx.path : 'index.html');
    return serveFile(fullPath, 'auto')(ctx, next)
}

async function treatIndex(ctx: Koa.Context, body: string) {
    const session = await refresh_session({}, ctx)
    ctx.set('etag', '')
    return body
        .replace(/((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1' + FRONTEND_URI)
        .replace('_HFS_SESSION_', session instanceof ApiError ? 'null' : JSON.stringify(session))
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

export const serveAdminFiles = serveAdminProxy(process.env.ADMIN_PROXY)
    || serveAdminStatic

export const serveFrontend = serveProxyFrontend(process.env.FRONTEND_PROXY)
    || serveStaticFrontend

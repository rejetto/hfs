// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import fs from 'fs/promises'
import { METHOD_NOT_ALLOWED, NO_CONTENT, PLUGINS_PUB_URI, UNAUTHORIZED } from './const'
import { serveFile } from './serveFile'
import { mapPlugins } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apiMiddleware'
import path from 'path'

// in case of dev env we have our static files within the 'dist' folder'
const DEV_STATIC = process.env.DEV ? '../dist/' : ''

function serveStatic(uri: string): Koa.Middleware {
    const folder = uri.slice(2,-1) // we know folder is very similar to uri
    return async (ctx, next) => {
        const loginRequired = ctx.status === UNAUTHORIZED
        const serveApp = ctx.path.endsWith('/') || loginRequired
        const fullPath = path.join(__dirname, '..', DEV_STATIC, folder, serveApp? '/index.html': ctx.path)
        if(ctx.method === 'OPTIONS') {
            ctx.status = NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = METHOD_NOT_ALLOWED
        if (!serveApp)
            return serveFile(fullPath, 'auto', getModifier(ctx.path, uri))(ctx, next)
        // we don't cache the index as it's small and may prevent plugins change to apply
        ctx.body = await treatIndex(ctx, String(await fs.readFile(fullPath)), uri)
        ctx.type = 'html'
        ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
}

function getModifier(path: string, uri: string) {
    return path.startsWith('/static/js') ? // webpack
        (s: string) => s.replace(/(")(static\/)/g, '$1' + uri.substring(1) + '$2')
        : undefined
}

async function treatIndex(ctx: Koa.Context, body: string, filesUri: string) {
    const session = await refresh_session({}, ctx)
    ctx.set('etag', '')
    return body
        .replace(/((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1' + filesUri)
        .replace('_HFS_SESSION_', session instanceof ApiError ? 'null' : JSON.stringify(session))
        // replacing this text allow us to avoid injecting in frontends that don't support plugins. Don't use a <--comment--> or it will be removed by webpack
        .replace('_HFS_PLUGINS_', pluginsInjection)
}

function serveProxied(port: string | undefined, uri: string) { // used for development
    if (!port)
        return
    console.debug('proxied on port', port)
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib => // dynamic import to avoid having this in final distribution
        proxy = lib.default('127.0.0.1:'+port, {
            proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
            userResDecorator(res, data, ctx) {
                if (ctx.path.endsWith('/'))
                    return treatIndex(ctx, String(data), uri)
                const mod = getModifier(ctx.path, uri)
                return mod ? mod(String(data)) : data
            }
        }) )
    return function() { //@ts-ignore
        return proxy.apply(this,arguments)
    }
}

function pluginsInjection() {
    const css = mapPlugins((plug,k) =>
        plug.frontend_css?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
    const js = mapPlugins((plug,k) =>
        plug.frontend_js?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
    return css.map(uri => `\n<link rel='stylesheet' type='text/css' href='${uri}'/>`).join('')
        + js.map(uri => `\n<script defer src='${uri}'></script>`).join('')
}

export function serveGuiFiles(proxyPort:string | undefined, uri:string) {
    return serveProxied(proxyPort, uri) || serveStatic(uri)
}

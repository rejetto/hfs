// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import fs from 'fs/promises'
import { METHOD_NOT_ALLOWED, NO_CONTENT, PLUGINS_PUB_URI, UNAUTHORIZED } from './const'
import { serveFile } from './serveFile'
import { mapPlugins } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apiMiddleware'
import path from 'path'
import { getOrSet } from './misc'

// in case of dev env we have our static files within the 'dist' folder'
const DEV_STATIC = process.env.DEV ? '../dist/' : ''

function serveStatic(uri: string): Koa.Middleware {
    const folder = uri.slice(2,-1) // we know folder is very similar to uri
    const cache: Record<string, Promise<string>> = {}
    return async (ctx, next) => {
        if(ctx.method === 'OPTIONS') {
            ctx.status = NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = METHOD_NOT_ALLOWED
        const loginRequired = ctx.status === UNAUTHORIZED
        const serveApp = ctx.path.endsWith('/') || loginRequired
        const fullPath = path.join(__dirname, '..', DEV_STATIC, folder, serveApp? '/index.html': ctx.path)
        const content = await getOrSet(cache, ctx.path, async () => {
            const data = await fs.readFile(fullPath).catch(() => null)
            return serveApp || !data ? data : adjustWebpackLinks(ctx.path, uri, data)
        })
        if (content === null)
            return ctx.status = 404
        if (!serveApp)
            return serveFile(fullPath, 'auto', content)(ctx, next)
        // we don't cache the index as it's small and may prevent plugins change to apply
        ctx.body = await treatIndex(ctx, String(content), uri)
        ctx.type = 'html'
        ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
}

function adjustWebpackLinks(path: string, uri: string, data: string | Buffer) {
    return path.startsWith('/static/js') // webpack
        ? String(data).replace(/(")(static\/)/g, '$1' + uri.substring(1) + '$2')
        : data
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

function serveProxied(port: string | undefined, uri: string) { // used for development only
    if (!port)
        return
    console.debug('proxied on port', port)
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib => // dynamic import to avoid having this in final distribution
        proxy = lib.default('127.0.0.1:'+port, {
            proxyReqPathResolver: (ctx) => ctx.path.endsWith('/') ? '/' : ctx.path,
            userResDecorator(res, data, ctx) {
                return ctx.path.endsWith('/') ? treatIndex(ctx, String(data), uri)
                    : adjustWebpackLinks(ctx.path, uri, data)
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

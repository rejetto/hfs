// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import fs from 'fs/promises'
import { FRONTEND_URI, METHOD_NOT_ALLOWED, NO_CONTENT, PLUGINS_PUB_URI } from './const'
import { serveFile } from './serveFile'
import { mapPlugins } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apis'
import path from 'path'

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

// in case of dev env we have our static files within the 'dist' folder'
const DEV_STATIC = process.env.DEV ? '../dist/' : ''

const serveStaticFrontend : Koa.Middleware =  async (ctx, next) => {
    const isDir = ctx.path.endsWith('/')
    const fullPath = path.join(__dirname, '..', DEV_STATIC, 'frontend', isDir ? '/index.html' : ctx.path)
    if (ctx.method === 'OPTIONS') {
        ctx.status = NO_CONTENT
        ctx.set({ Allow: 'OPTIONS, GET' })
        return
    }
    if (ctx.method !== 'GET')
        return ctx.status = METHOD_NOT_ALLOWED
    if (!isDir) {
        const modifier = fullPath.includes('static/js') ? // webpack
            (s:string) => s.replace(/(return")(static\/)/g, '$1' + FRONTEND_URI.substring(1) + '$2')
            : undefined
        return serveFile(fullPath, 'auto', modifier)(ctx, next)
    }
    await serveIndex(ctx, fullPath)
    await next()
}

async function serveIndex(ctx: Koa.Context, fullPath: string) {
    // we don't cache the index as it's small and may prevent plugins change to apply
    ctx.body = await treatIndex(ctx, String(await fs.readFile(fullPath)))
    ctx.type = 'html'
    ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
}

function serveProxyAdmin(port?: string) { // used for development
    if (!port)
        return
    console.debug('admin: proxied')
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib =>
        proxy = lib.default('localhost:'+port, {
            userResDecorator(res, data, ctx) {
                return !ctx.path.includes('.') ? treatIndex(ctx, data.toString('utf8'))
                    : data
            }
        }) )
    return function() { //@ts-ignore
        return proxy.apply(this,arguments)
    }
}

const serveStaticAdmin : Koa.Middleware  = async (ctx, next) => {
    const index = !ctx.path.includes('.')
    const fullPath = path.join(__dirname, '..', DEV_STATIC, 'admin', index ? '/index.html' : ctx.path)
    return index ? await serveIndex(ctx, fullPath)
        : serveFile(fullPath, 'auto')(ctx, next)
}

async function treatIndex(ctx: Koa.Context, body: string) {
    const session = await refresh_session({}, ctx)
    ctx.set('etag', '')
    return body
        .replace(ctx.state.admin ? /^NEVER$/ : /((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1' + FRONTEND_URI)
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

export const serveAdminFiles = serveProxyAdmin(process.env.ADMIN_PROXY)
    || serveStaticAdmin

export const serveFrontend = serveProxyFrontend(process.env.FRONTEND_PROXY)
    || serveStaticFrontend

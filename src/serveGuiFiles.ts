// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import fs from 'fs/promises'
import {
    API_VERSION,
    FRONTEND_URI,
    HTTP_METHOD_NOT_ALLOWED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    PLUGINS_PUB_URI,
    VERSION
} from './const'
import { serveFile } from './serveFile'
import { getPluginConfigFields, getPluginInfo, mapPlugins, pluginsConfig } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apiMiddleware'
import { join, extname } from 'path'
import { getOrSet, newObj, onlyTruthy } from './misc'
import { favicon, title } from './adminApis'
import { subscribe } from 'valtio'
import { customHtmlState, getSection } from './customHtml'
import _ from 'lodash'
import { getWholeConfig } from './config'

// in case of dev env we have our static files within the 'dist' folder'
const DEV_STATIC = process.env.DEV ? 'dist/' : ''

function serveStatic(uri: string): Koa.Middleware {
    const folder = uri.slice(2,-1) // we know folder is very similar to uri
    let cache: Record<string, Promise<string>> = {}
    subscribe(customHtmlState, () => cache = {}) // reset cache at every change
    return async (ctx) => {
        if(ctx.method === 'OPTIONS') {
            ctx.status = HTTP_NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        const serveApp = shouldServeApp(ctx)
        const fullPath = join(__dirname, '..', DEV_STATIC, folder, serveApp ? '/index.html': ctx.path)
        const content = await getOrSet(cache, ctx.path, async () => {
            const data = await fs.readFile(fullPath).catch(() => null)
            return serveApp || !data ? data
                : adjustBundlerLinks(ctx, uri, data)
        })
        if (content === null)
            return ctx.status = HTTP_NOT_FOUND
        if (!serveApp)
            return serveFile(ctx, fullPath, 'auto', content)
        // we don't cache the index as it's small and may prevent plugins change to apply
        ctx.body = await treatIndex(ctx, uri, String(content))
        ctx.type = 'html'
        ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    }
}

function shouldServeApp(ctx: Koa.Context) {
    return ctx.state.serveApp ||= ctx.path.endsWith('/')
}

function adjustBundlerLinks(ctx: Koa.Context, uri: string, data: string | Buffer) {
    const ext = extname(ctx.path)
    return ext && !ext.match(/\.(css|html|js|ts|scss)/) ? data
        : String(data).replace(/((?:import | from )['"])\//g, `$1${ctx.state.revProxyPath}${uri}`)
}

async function treatIndex(ctx: Koa.Context, filesUri: string, body: string) {
    const session = await refresh_session({}, ctx)
    ctx.set('etag', '')

    const isFrontend = filesUri === FRONTEND_URI

    const pub = ctx.state.revProxyPath + PLUGINS_PUB_URI
    const css = mapPlugins((plug,k) =>
        (isFrontend ? plug.frontend_css : null)?.map(f => pub + k + '/' + f)).flat().filter(Boolean)
    const js = mapPlugins((plug,k) =>
        (isFrontend ? plug.frontend_js : null)?.map(f => pub + k + '/' + f)).flat().filter(Boolean)

    // expose plugins' configs that are declared with 'frontend' attribute
    const plugins = Object.fromEntries(onlyTruthy(mapPlugins((pl,name) => {
        let configs = newObj(getPluginConfigFields(name), (v, k, skip) =>
            !v.frontend ? skip() :
                (pluginsConfig.get()?.[name]?.[k] ?? pl.getData().config?.[k]?.defaultValue)
        )
        configs = getPluginInfo(name).onFrontendConfig?.(configs) || configs
        return !_.isEmpty(configs) && [name, configs]
    })))
    let ret = body
        .replace(/((?:src|href) *= *['"])\/?(?![a-z]+:\/\/)/g, '$1' + ctx.state.revProxyPath + filesUri)
        .replace('</head>', () => `
            ${!isFrontend ? '' : `
                <title>${title.get()}</title>
                <link rel="icon" href="${favicon.get() ? '/favicon.ico' : 'data:;'}" />
            `}
            <script>
            HFS = ${JSON.stringify({
                VERSION,
                API_VERSION,
                session: session instanceof ApiError ? null : session,
                plugins,
                prefixUrl: ctx.state.revProxyPath,
                customHtml: _.omit(Object.fromEntries(customHtmlState.sections),
                    ['top','bottom']), // excluding sections we apply in this phase  
        }, null, 4)}
            document.documentElement.setAttribute('ver', '${VERSION.split('-')[0] /*for style selectors*/}')
            </script>
            <style>
            :root {
                ${_.map(plugins, (configs, pluginName) => 
                    _.map(configs, (v,k) => `--${pluginName}-${k}: ${serializeCss(v)};`).join('\n')).join('')}
            }
            </style>
            ${css.map(uri => `<link rel='stylesheet' type='text/css' href='${uri}'/>`).join('\n')}
            ${js.map(uri => `<script defer src='${uri}'></script>`).join('\n')}
        </head>`)
    if (isFrontend)
        ret = ret
            .replace('<body>', '<body>' + getSection('top'))
            .replace('</body>', getSection('bottom') + '</body>')
    return ret
}

function serializeCss(v: any) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}|rgba?\(.+\)$/.test(v) ? v
        : JSON.stringify(v)
}

function serveProxied(port: string | undefined, uri: string) { // used for development only
    if (!port)
        return
    console.debug('proxied on port', port)
    let proxy: Koa.Middleware
    import('koa-better-http-proxy').then(lib => // dynamic import to avoid having this in final distribution
        proxy = lib.default('127.0.0.1:'+port, {
            proxyReqPathResolver: (ctx) =>
                shouldServeApp(ctx) ? '/' : ctx.path,
            userResDecorator(res, data, ctx) {
                return shouldServeApp(ctx) ? treatIndex(ctx, uri, String(data))
                    : adjustBundlerLinks(ctx, uri, data)
            }
        }) )
    return function() { //@ts-ignore
        return proxy.apply(this,arguments)
    }
}

export function serveGuiFiles(proxyPort:string | undefined, uri:string) {
    return serveProxied(proxyPort, uri) || serveStatic(uri)
}

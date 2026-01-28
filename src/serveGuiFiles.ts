// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import {
    API_VERSION, MIME_AUTO, FRONTEND_URI, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_NOT_FOUND,
    PLUGINS_PUB_URI, VERSION, SPECIAL_URI, ICONS_URI, DEV
} from './const'
import { serveFile } from './serveFile'
import { getPluginConfigFields, getPluginInfo, mapPlugins, pluginsConfig } from './plugins'
import { refresh_session } from './api.auth'
import { ApiError } from './apiMiddleware'
import { join, extname } from 'path'
import {
    CFG, debounceAsync, formatBytes, FRONTEND_OPTIONS, isPrimitive, newObj, objSameKeys, onlyTruthy, parseFile,
    enforceStarting, statWithTimeout
} from './misc'
import { favicon, title } from './adminApis'
import { getAllSections, getSection } from './customHtml'
import _ from 'lodash'
import { defineConfig, getConfig } from './config'
import { getLangData } from './lang'
import { dontOverwriteUploading } from './upload'
import { customizedIcons, CustomizedIcons } from './icons'
import { getProxyDetected } from './middlewares'

const size1024 = defineConfig(CFG.size_1024, false, x => formatBytes.k = x ? 1024 : 1000) // we both configure formatBytes, and also provide a compiled version (number instead of boolean)
const splitUploads = defineConfig(CFG.split_uploads, 0)
export const logGui = defineConfig(CFG.log_gui, false)
_.each(FRONTEND_OPTIONS, (v,k) => defineConfig(k, v)) // define default values

function serveStatic(uri: string): Koa.Middleware {
    const folder = (DEV ? 'dist/' : '') + uri.slice(2,-1)
    return async ctx => {
        if (!logGui.get())
            ctx.state.dontLog = true
        if(ctx.method === 'OPTIONS') {
            ctx.status = HTTP_NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        const serveApp = shouldServeApp(ctx)
        const fullPath = join(__dirname, '..', folder, serveApp ? '/index.html': ctx.path)
        const content = await parseFile(fullPath,
            raw => serveApp || !raw.length ? raw : adjustBundlerLinks(ctx, uri, raw) )
            .catch(() => null)
        if (content === null)
            return ctx.status = HTTP_NOT_FOUND
        if (!serveApp)
            return serveFile(ctx, fullPath, MIME_AUTO, content)
        // we don't cache the index as it's small and may prevent plugins change to apply
        ctx.body = await treatIndex(ctx, uri, String(content))
    }
}

function shouldServeApp(ctx: Koa.Context) {
    return ctx.state.serveApp ||= ctx.path.endsWith('/') && !ctx.headers.upgrade // skip websockets
}

function adjustBundlerLinks(ctx: Koa.Context, uri: string, data: string | Buffer) {
    const ext = extname(ctx.path)
    return ext && !ext.match(/\.(css|html|js|ts|scss)/) ? data
        : String(data).replace(/((?:import[ (]| from )['"])\//g, `$1${ctx.state.revProxyPath}${uri}`)
}

const getFaviconTimestamp = debounceAsync(async () => {
    const f = favicon.get()
    return !f ? 0 : statWithTimeout(f).then(x => x?.mtimeMs || 0, () => 0)
}, { retain: 5_000 })

async function treatIndex(ctx: Koa.Context, filesUri: string, body: string) {
    const session = await refresh_session({}, ctx)
    ctx.set('etag', '')
    ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    ctx.type = 'html'

    const isFrontend = filesUri === FRONTEND_URI ? ' ' : '' // as a string will allow neater code later

    const pub = ctx.state.revProxyPath + PLUGINS_PUB_URI

    // expose plugins' configs that are declared with 'frontend' attribute
    const plugins = Object.fromEntries(onlyTruthy(mapPlugins((pl,name) => {
        let configs = newObj(getPluginConfigFields(name), (v, k, skip) =>
            !v.frontend ? skip() :
                adjustValueByConfig(pluginsConfig.get()?.[name]?.[k], pl.getData().config?.[k])
        )
        configs = getPluginInfo(name).onFrontendConfig?.(configs) || configs
        return !_.isEmpty(configs) && [name, configs]
    })))
    const timestamp = await getFaviconTimestamp()
    const lang = await getLangData(ctx)
    return body
        .replace(/((?:src|href) *= *['"])\/?(?!([a-z]+:\/)?\/)(?!\?)/g, '$1' + ctx.state.revProxyPath + filesUri)
        .replace(/<(\/)?(head|body)>/g, (all, isClose, name) => { // must make these changes in one .replace call, otherwise we may encounter head/body tags due to customHtml. This simple trick makes html parsing unnecessary.
            const isHead = name === 'head'
            const isBody = !isHead
            const isOpen = !isClose
            if (isHead && isOpen)
                return all + `
                    <script>
                    HFS = ${JSON.stringify({
                        VERSION,
                        API_VERSION,
                        SPECIAL_URI, PLUGINS_PUB_URI, FRONTEND_URI,
                        session: session instanceof ApiError ? null : session,
                        plugins,
                        loadScripts: Object.fromEntries(mapPlugins((p, id) =>  [id, p.frontend_js?.map(f => f.includes('//') ? f : pub + id + '/' + f)])),
                        prefixUrl: ctx.state.revProxyPath || '',
                        proxyDetected: Boolean(getProxyDetected()),
                        dontOverwriteUploading: dontOverwriteUploading.get(),
                        splitUploads: splitUploads.get(),
                        kb: size1024.compiled(),
                        forceTheme: mapPlugins(p => _.isString(p.isTheme) ? p.isTheme : undefined).find(Boolean),
                        customHtml: _.omit(getAllSections(), ['top', 'bottom', 'htmlHead', 'style']), // exclude the sections we already apply in this phase
                        ...newObj(FRONTEND_OPTIONS, (v, k) => getConfig(k)),
                        icons: Object.assign({}, ...mapPlugins(p => iconsToObj(p.icons, p.id + '/')), iconsToObj(customizedIcons)), // name-to-uri 
                        lang
                    }, null, 4).replace(/<(\/script)/g, '<"+"$1') /*avoid breaking our script container*/}
                    document.documentElement.setAttribute('ver', HFS.VERSION.split('-')[0])
                    </script>
                    ${isFrontend && `
                        <title>${title.get()}</title>
                        <link rel="shortcut icon" href="${ctx.state.revProxyPath}/favicon.ico?${timestamp}" />
                    ${getSection('htmlHead')}`}
                `
            function iconsToObj(icons: CustomizedIcons, pre='') {
                return icons && objSameKeys(icons, (v, k) => ctx.state.revProxyPath + ICONS_URI + pre + k)
            }

            if (isBody && isOpen)
                return `${all}
                    ${isFrontend && getSection('top')}
                    <style>
                    :root {
                        ${_.map(plugins, (configs, pluginName) => // make plugin configs accessible via css
                            _.map(configs, (v, k) => {
                                v = serializeCss(v)
                                return typeof v === 'string' && `\n--${pluginName}-${k}: ${v};`
                            }).filter(Boolean).join('')).join('')}
                    }
                    ${isFrontend && getSection('style')}
                    </style>
                    ${isFrontend && mapPlugins((plug,id) =>
                        plug.frontend_css?.map(f =>
                            `<link rel='stylesheet' type='text/css' href='${f.includes('//') ? f : pub + id + '/' + f}' plugin=${JSON.stringify(id)}/>`))
                        .flat().filter(Boolean).join('\n')}
                `
            if (isBody && isClose)
                return getSection('bottom') + all
            return all // unchanged
        })

    function adjustValueByConfig(v: any, cfg: any) {
        v ??= cfg.defaultValue
        const {type} = cfg
        if (v && type === 'vfs_path') {
            v = enforceStarting('/', v)
            const { root } = ctx.state
            if (root)
                if (v.startsWith(root))
                    v = v.slice(root.length - 1)
                else
                    return
            if (ctx.state.revProxyPath)
                v = ctx.state.revProxyPath + v
        }
        else if (type === 'array' && Array.isArray(v))
            v = v.map(x => objSameKeys(x, (xv, xk) => adjustValueByConfig(xv, cfg.fields[xk])))
        return v
    }

}

function serializeCss(v: any) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}|rgba?\(.+\)$/.test(v) ? v // colors
        : isPrimitive(v) ? JSON.stringify(v)?.replace(/</g, '&lt;') : undefined
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
    return function (ctx, next) {
        if (!logGui.get())
            ctx.state.dontLog = true
        return proxy(ctx, next)
    } as Koa.Middleware
}

export function serveGuiFiles(proxyPort:string | undefined, uri:string) {
    return serveProxied(proxyPort, uri) || serveStatic(uri)
}

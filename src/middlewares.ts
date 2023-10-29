// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import { ADMIN_URI, API_URI, BUILD_TIMESTAMP, DEV,
    HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_FOOL, HTTP_UNAUTHORIZED, HTTP_BAD_REQUEST, HTTP_METHOD_NOT_ALLOWED,
} from './const'
import { FRONTEND_URI } from './const'
import { statusCodeForMissingPerm, nodeIsDirectory, urlToNode, vfs, walkNode, VfsNode, getNodeName } from './vfs'
import { DAY, asyncGeneratorToReadable, dirTraversal, filterMapGenerator, isLocalHost, stream2string, tryJson,
    splitAt } from './misc'
import { zipStreamFromFolder } from './zip'
import { serveFile, serveFileNode } from './serveFile'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { Readable } from 'stream'
import { applyBlock } from './block'
import { accountCanLogin, getAccount } from './perm'
import { socket2connection, updateConnection, normalizeIp } from './connections'
import basicAuth from 'basic-auth'
import { srpCheck } from './auth'
import { basename, dirname } from 'path'
import { pipeline } from 'stream/promises'
import formidable from 'formidable'
import { uploadWriter } from './upload'
import { allowAdmin, favicon } from './adminApis'
import { constants } from 'zlib'
import { baseUrl, getHttpsWorkingPort } from './listen'
import { defineConfig } from './config'
import { sendErrorPage } from './errorPages'

const forceHttps = defineConfig('force_https', true)
const ignoreProxies = defineConfig('ignore_proxies', false)
export const sessionDuration = defineConfig('session_duration', Number(process.env.SESSION_DURATION) || DAY/1000,
    v => v * 1000)

export const gzipper = compress({
    threshold: 2048,
    gzip: { flush: constants.Z_SYNC_FLUSH },
    deflate: { flush: constants.Z_SYNC_FLUSH },
    br: false, // disable brotli
    filter(type) {
        return /text|javascript|style/i.test(type)
    },
})

export const headRequests: Koa.Middleware = async (ctx, next) => {
    const head = ctx.method === 'HEAD'
    if (head)
        ctx.method = 'GET' // let other middlewares work, so we can collect the size at the end
    await next()
    if (!head || ctx.body === undefined) return
    const { length, status } = ctx.response
    if (ctx.body)
        ctx.body = Readable.from('') // empty the body for this is a HEAD request. Using Readable avoids koa from trying to set length to 0
    ctx.status = status
    if (length)
        ctx.response.length = length
}

const serveFrontendFiles = serveGuiFiles(process.env.FRONTEND_PROXY, FRONTEND_URI)
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontendFiles)
const serveAdminFiles = serveGuiFiles(process.env.ADMIN_PROXY, ADMIN_URI)
const serveAdminPrefixed = mount(ADMIN_URI.slice(0,-1), serveAdminFiles)

export const serveGuiAndSharedFiles: Koa.Middleware = async (ctx, next) => {
    const { path } = ctx
    // dynamic import on frontend|admin (used for non-https login) while developing (vite4) is not producing a relative path
    if (DEV && path.startsWith('/node_modules/')) {
        let { referer } = ctx.headers
        referer &&= new URL(referer).pathname
        return referer?.startsWith(ADMIN_URI) ? serveAdminFiles(ctx, next)
            : serveFrontendFiles(ctx, next)
    }
    if (ctx.body)
        return next()
    if (!ctx.secure && forceHttps.get() && getHttpsWorkingPort() && !isLocalHost(ctx)) {
        const { URL } = ctx
        URL.protocol = 'https'
        URL.port = getHttpsWorkingPort()
        ctx.status = 307 // this ensures the client doesn't switch to a simpler GET request
        return ctx.redirect(URL.href)
    }

    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path.length === ADMIN_URI.length - 1 && ADMIN_URI.startsWith(path))
        return ctx.redirect(ctx.state.revProxyPath + ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return allowAdmin(ctx) ? serveAdminPrefixed(ctx,next)
            : sendErrorPage(ctx, HTTP_FORBIDDEN)
    if (ctx.method === 'PUT') { // curl -T file url/
        const decPath = decodeURI(path)
        let rest = basename(decPath)
        const folder = await urlToNode(dirname(decPath), ctx, vfs, v => rest = v+'/'+rest)
        if (!folder)
            return sendErrorPage(ctx, HTTP_NOT_FOUND)
        const dest = uploadWriter(folder, rest, ctx)
        if (dest) {
            await pipeline(ctx.req, dest)
            ctx.body = {}
        }
        return
    }
    if (ctx.originalUrl === '/favicon.ico' && favicon.get()) // originalUrl to not be subject to changes (vhosting plugin)
        return serveFile(ctx, favicon.get())
    let node = await urlToNode(path, ctx)
    if (!node)
        return sendErrorPage(ctx, HTTP_NOT_FOUND)
    if (ctx.method === 'POST') { // curl -F upload=@file url/
        if (ctx.request.type !== 'multipart/form-data')
            return ctx.status = HTTP_BAD_REQUEST
        ctx.body = {}
        const form = formidable({
            maxFileSize: Infinity,
            allowEmptyFiles: true,
            //@ts-ignore wrong in the .d.ts file
            fileWriteStreamHandler: f => uploadWriter(node, f.originalFilename, ctx)
        })
        return new Promise<void>(res => form.parse(ctx.req, err => {
            if (err) console.error(String(err))
            res()
        }))
    }
    if (node.default && path.endsWith('/')) // final/ needed on browser to make resource urls correctly with html pages
        node = await urlToNode(node.default, ctx, node) ?? node
    if (!await nodeIsDirectory(node))
        return !node.source ? sendErrorPage(ctx, HTTP_METHOD_NOT_ALLOWED)
            : !statusCodeForMissingPerm(node, 'can_read', ctx) ? serveFileNode(ctx, node)
            : ctx.status !== HTTP_UNAUTHORIZED ? null
            : !path.endsWith('/') ? ctx.set('WWW-Authenticate', 'Basic') // this is necessary to support standard urls with credentials. Final / means we are dealing with default file...
            : (ctx.state.serveApp = true) && serveFrontendFiles(ctx, next) // ...for which we still provide fancy login
    if (!path.endsWith('/'))
        return ctx.redirect(ctx.state.revProxyPath + ctx.originalUrl.replace(/(\?|$)/, '/$1')) // keep query-string, if any
    if (statusCodeForMissingPerm(node, 'can_list', ctx)) {
        if (ctx.status === HTTP_FORBIDDEN)
            return sendErrorPage(ctx, HTTP_FORBIDDEN)
        const browserDetected = ctx.get('Upgrade-Insecure-Requests') || ctx.get('Sec-Fetch-Mode') // ugh, heuristics
        if (!browserDetected) // we don't want to trigger basic authentication on browsers, it's meant for download managers only
            return ctx.set('WWW-Authenticate', 'Basic') // we support basic authentication
        ctx.state.serveApp = true
        return serveFrontendFiles(ctx, next)
    }
    ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
    return ctx.query.get === 'zip' ? zipStreamFromFolder(node, ctx)
        : ctx.query.get === 'list' ? sendFolderList(node, ctx)
        : serveFrontendFiles(ctx, next)
}

// to be used with errors whose recipient is possibly human
async function sendFolderList(node: VfsNode, ctx: Koa.Context) {
    let { depth=0, folders, prepend } = ctx.query
    ctx.type = 'text'
    if (prepend === undefined || prepend === '*') { // * = force auto-detection even if we have baseUrl set
        const { URL } = ctx
        const base = prepend === undefined && baseUrl.get()
            || URL.protocol + '//' + URL.host + ctx.state.revProxyPath
        prepend = base + ctx.originalUrl.split('?')[0]! as string
    }
    const walker = walkNode(node, ctx, depth === '*' ? Infinity : Number(depth))
    ctx.body = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
        const isFolder = await nodeIsDirectory(el)
        return !folders && isFolder ? undefined
            : prepend + getNodeName(el) + (isFolder ? '/' : '') + '\n'
    }))
}

let proxyDetected: undefined | Koa.Context
export const someSecurity: Koa.Middleware = async (ctx, next) => {
    ctx.request.ip = normalizeIp(ctx.ip)
    // don't allow sessions to change ip
    const ss = ctx.session
    if (ss?.username)
        if (!ss.ip)
            ss.ip = ctx.ip
        else if (ss.ip !== ctx.ip) {
            delete ss.username
            ss.ip = ctx.ip
        }

    try {
        if (dirTraversal(decodeURI(ctx.path)))
            return ctx.status = HTTP_FOOL
        if (applyBlock(ctx.socket, ctx.ip))
            return

        if (!ctx.ips.length && ctx.get('X-Forwarded-For') // empty ctx.ips implies we didn't configure for proxies
        // we have some dev-proxies to ignore
        && !(DEV && [process.env.FRONTEND_PROXY, process.env.ADMIN_PROXY].includes(ctx.get('X-Forwarded-port')))) {
            proxyDetected = ctx
            ctx.state.when = new Date()
        }
    }
    catch {
        return ctx.status = HTTP_FOOL
    }
    return next()
}

// limited to http proxies
export function getProxyDetected() {
    if (proxyDetected?.state.when < Date.now() - DAY)
        proxyDetected = undefined
    return !ignoreProxies.get() && proxyDetected
        && { from: proxyDetected.ip, for: proxyDetected.get('X-Forwarded-For') }
}

export const prepareState: Koa.Middleware = async (ctx, next) => {
    if (ctx.session)
        ctx.session.maxAge = sessionDuration.compiled()
    // calculate these once and for all
    const a = ctx.state.account = await urlLogin() || await getHttpAccount() || getAccount(ctx.session?.username, false)
    if (a && !accountCanLogin(a))
        ctx.state.account = undefined
    const conn = ctx.state.connection = socket2connection(ctx.socket)
    ctx.state.revProxyPath = ctx.get('x-forwarded-prefix')
    if (conn)
        updateConnection(conn, { ctx, op: undefined })
    await next()

    async function urlLogin() {
        const { login }  = ctx.query
        if (!login) return
        const [u,p] = splitAt(':', String(login))
        const a = await srpCheck(u, p)
        if (a) {
            ctx.session!.username = a.username
            ctx.redirect(ctx.originalUrl.slice(0, -ctx.querystring.length-1))
        }
        return a
    }

    async function getHttpAccount() {
        const credentials = basicAuth(ctx.req)
        return srpCheck(credentials?.name||'', credentials?.pass||'')
    }
}

export const paramsDecoder: Koa.Middleware = async (ctx, next) => {
    ctx.params = ctx.method === 'POST' && ctx.originalUrl.startsWith(API_URI)
        && (tryJson(await stream2string(ctx.req)) || {})
    await next()
}

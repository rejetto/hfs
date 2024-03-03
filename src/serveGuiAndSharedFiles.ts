import Koa from 'koa'
import { basename, dirname } from 'path'
import { getNodeName, nodeIsDirectory, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode } from './vfs'
import { sendErrorPage } from './errorPages'
import { ADMIN_URI, FRONTEND_URI, HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND,
    HTTP_UNAUTHORIZED } from './cross-const'
import { uploadWriter } from './upload'
import { pipeline } from 'stream/promises'
import formidable from 'formidable'
import { Writable } from 'stream'
import { serveFile, serveFileNode } from './serveFile'
import { BUILD_TIMESTAMP, DEV, VERSION } from './const'
import { zipStreamFromFolder } from './zip'
import { allowAdmin, favicon } from './adminApis'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { baseUrl } from './listen'
import { asyncGeneratorToReadable, filterMapGenerator, pathEncode } from './misc'

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
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path.length === ADMIN_URI.length - 1 && ADMIN_URI.startsWith(path))
        return ctx.redirect(ctx.state.revProxyPath + ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return allowAdmin(ctx) ? serveAdminPrefixed(ctx,next)
            : sendErrorPage(ctx, HTTP_FORBIDDEN)
    if (ctx.method === 'PUT') { // curl -T file url/
        const decPath = decodeURIComponent(path)
        let rest = basename(decPath)
        const folder = await urlToNode(dirname(decPath), ctx, vfs, v => rest = v+'/'+rest)
        if (!folder)
            return sendErrorPage(ctx, HTTP_NOT_FOUND)
        ctx.state.uploadPath = decPath
        const dest = uploadWriter(folder, rest, ctx)
        if (dest) {
            await pipeline(ctx.req, dest)
            ctx.body = {}
        }
        return
    }
    if (/^\/favicon.ico(\??.*)/.test(ctx.originalUrl) && favicon.get()) // originalUrl to not be subject to changes (vhosting plugin)
        return serveFile(ctx, favicon.get())
    let node = await urlToNode(path, ctx)
    if (!node)
        return sendErrorPage(ctx, HTTP_NOT_FOUND)
    if (ctx.method === 'POST') { // curl -F upload=@file url/
        if (ctx.request.type !== 'multipart/form-data')
            return ctx.status = HTTP_BAD_REQUEST
        ctx.body = {}
        ctx.state.uploads = []
        const form = formidable({
            maxFileSize: Infinity,
            allowEmptyFiles: true,
            fileWriteStreamHandler: f => {
                const fn = (f as any).originalFilename
                ctx.state.uploadPath = decodeURI(ctx.path) + fn
                ctx.state.uploads!.push(fn)
                return uploadWriter(node!, fn, ctx) || new Writable()
            }
        })
        return new Promise<void>(res => form.parse(ctx.req, err => {
            if (err) console.error(String(err))
            res()
        }))
    }
    const { get } = ctx.query
    if (node.default && path.endsWith('/') && !get) // final/ needed on browser to make resource urls correctly with html pages
        node = await urlToNode(node.default, ctx, node) ?? node
    if (!await nodeIsDirectory(node))
        return !node.source ? sendErrorPage(ctx, HTTP_METHOD_NOT_ALLOWED)
            : !statusCodeForMissingPerm(node, 'can_read', ctx) ? serveFileNode(ctx, node)
                : ctx.status !== HTTP_UNAUTHORIZED ? null
                    : !path.endsWith('/') ? (ctx.set('WWW-Authenticate', 'Basic'), sendErrorPage(ctx)) // this is necessary to support standard urls with credentials. Final / means we are dealing with default file...
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
    ctx.set({ server: `HFS ${VERSION} ${BUILD_TIMESTAMP}` })
    return get === 'zip' ? zipStreamFromFolder(node, ctx)
        : get === 'list' ? sendFolderList(node, ctx)
            : serveFrontendFiles(ctx, next)
}

async function sendFolderList(node: VfsNode, ctx: Koa.Context) {
    let { depth=0, folders, prepend } = ctx.query
    ctx.type = 'text'
    if (prepend === undefined || prepend === '*') { // * = force auto-detection even if we have baseUrl set
        const { URL } = ctx
        const base = prepend === undefined && baseUrl.get()
            || URL.protocol + '//' + URL.host + ctx.state.revProxyPath
        prepend = base + ctx.originalUrl.split('?')[0]! as string
    }
    const walker = walkNode(node, { ctx, depth: depth === '*' ? Infinity : Number(depth) })
    ctx.body = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
        const isFolder = await nodeIsDirectory(el)
        return !folders && isFolder ? undefined
            : prepend + pathEncode(getNodeName(el)) + (isFolder ? '/' : '') + '\n'
    }))
}

declare module "koa" {
    interface DefaultState {
        serveApp?: boolean // please, serve the frontend app
        uploadPath?: string // current one
        uploads?: string[] // in case of request with potentially multiple uploads (POST), we register all filenames (no full path)
    }
}
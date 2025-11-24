import Koa from 'koa'
import { basename, dirname, join } from 'path'
import { getNodeName, nodeIsFolder, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode } from './vfs'
import { sendErrorPage } from './errorPages'
import events from './events'
import {
    ADMIN_URI, FRONTEND_URI, HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND,
    HTTP_UNAUTHORIZED, HTTP_SERVER_ERROR, HTTP_OK, ICONS_URI, HTTP_FAILED_DEPENDENCY, UPLOAD_TEMP_HASH
} from './cross-const'
import { getUploadTempFor, uploadWriter } from './upload'
import formidable from 'formidable'
import { once } from 'events'
import { Transform, Writable } from 'stream'
import { serveFile, serveFileNode } from './serveFile'
import { BUILD_TIMESTAMP, DEV, MIME_AUTO, VERSION } from './const'
import { zipStreamFromFolder } from './zip'
import { preventAdminAccess, favicon } from './adminApis'
import { serveGuiFiles } from './serveGuiFiles'
import mount from 'koa-mount'
import { baseUrl } from './listen'
import { asyncGeneratorToReadable, filterMapGenerator, loadFileCached, pathEncode, try_ } from './misc'
import XXH from 'xxhashjs'
import fs from 'fs'
import { rm } from 'fs/promises'
import { setCommentFor } from './comments'
import { basicWeb, detectBasicAgent } from './basicWeb'
import { customizedIcons, ICONS_FOLDER } from './icons'
import { getPluginInfo } from './plugins'

const serveFrontendFiles = serveGuiFiles(process.env.FRONTEND_PROXY, FRONTEND_URI)
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontendFiles)
const serveAdminFiles = serveGuiFiles(process.env.ADMIN_PROXY, ADMIN_URI)
const serveAdminPrefixed = mount(ADMIN_URI.slice(0,-1), serveAdminFiles)

export const serveGuiAndSharedFiles: Koa.Middleware = async (ctx, next) => {
    const { path } = ctx
    // dynamic import on frontend|admin (used for non-https login) while developing (vite4) is not producing a relative path
    if (DEV && path.startsWith('/node_modules/')) {
        const { referer: r } = ctx.headers
        return try_(() => r && new URL(r).pathname?.startsWith(ADMIN_URI)) ? serveAdminFiles(ctx, next)
            : serveFrontendFiles(ctx, next)
    }
    if (path.startsWith(FRONTEND_URI))
        return serveFrontendPrefixed(ctx,next)
    if (path.length === ADMIN_URI.length - 1 && ADMIN_URI.startsWith(path))
        return ctx.redirect(ctx.state.revProxyPath + ADMIN_URI)
    if (path.startsWith(ADMIN_URI))
        return preventAdminAccess(ctx) ? sendErrorPage(ctx, HTTP_FORBIDDEN) : serveAdminPrefixed(ctx, next)
    if (path.startsWith(ICONS_URI)) {
        const a = path.substring(ICONS_URI.length).split('/')
        const iconName = a.at(-1)
        if (!iconName) return
        const plugin = a.length > 1 && getPluginInfo(a[0]!) // an extra level in the path indicates a plugin
        const file = plugin ? plugin.icons?.[iconName] : customizedIcons?.[iconName]
        if (!file) return
        ctx.state.considerAsGui = true
        return serveFile(ctx, join(plugin?.folder || '', ICONS_FOLDER, file), MIME_AUTO)
    }
    const { get } = ctx.query
    const getUploadTempHash = get === UPLOAD_TEMP_HASH
    if (ctx.method === 'PUT' || getUploadTempHash) { // PUT is what you get with `curl -T file url/`
        const decPath = decodeURIComponent(path)
        let rest = basename(decPath)
        const folderUri = pathEncode(dirname(decPath)) // re-encode to get readable urls
        const folder = await urlToNode(folderUri, ctx, vfs, v => rest = v+'/'+rest)
        if (!folder)
            return sendErrorPage(ctx, HTTP_NOT_FOUND)
        ctx.state.uploadPath = decPath
        if (getUploadTempHash)
            return !folder.source ? sendErrorPage(ctx, HTTP_NOT_FOUND)
                : ctx.body = await loadFileCached(getUploadTempFor(join(folder.source, rest)), calcHash)  // negligible memory leak
        const dest = uploadWriter(folder, folderUri, rest, ctx)
        if (dest) {
            ctx.req.pipe(dest).on('error', err => {
                ctx.status = HTTP_SERVER_ERROR
                ctx.body = err.message || String(err)
            })
            ctx.req.on('close', () => dest.end())
            const uri = await dest.lockMiddleware  // we need to wait more than just the stream
            if (uri) // falsy = aborted
                ctx.body = { uri }
            else if (ctx.status === 404) // nodejs already sent 400, but koa ignores it (ctx.headersSent is false and ctx.status is 404), so we adjust koa state to have correct data in the log
                ctx.status = 400
        }
        return
    }
    if (/^\/favicon.ico(\??.*)/.test(ctx.originalUrl) && favicon.get() && ctx.method === 'GET') // originalUrl to not be subject to changes (vhosting plugin)
        return serveFile(ctx, favicon.get())
    let node = await urlToNode(path, ctx)
    if (!node)
        return sendErrorPage(ctx, HTTP_NOT_FOUND)
    if (ctx.method === 'POST') { // curl -F upload=@file url/
        if (ctx.request.type !== 'multipart/form-data')
            return ctx.status = HTTP_BAD_REQUEST
        ctx.state.uploads = []
        let locks: Promise<string>[] = []
        const form = formidable({
            maxFileSize: Infinity,
            allowEmptyFiles: true,
            fileWriteStreamHandler: f => {
                const fn = (f as any).originalFilename
                ctx.state.uploadPath = decodeURI(ctx.path) + fn
                ctx.state.uploads!.push(fn)
                const ret = uploadWriter(node!, path, fn, ctx)
                if (!ret)
                    return new Writable({ write(data,enc,cb) { cb() } }) // just discard data
                locks.push(ret.lockMiddleware)
                return ret
            }
        })
        const uris = await new Promise<string[]>(res => form.parse(ctx.req, async err => {
            if (err) console.error(String(err))
            res(Promise.all(locks))
        }))
        ctx.body = { uris }
        return
    }
    if (ctx.method === 'DELETE') {
        const { source } = node
        if (!source)
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        if (statusCodeForMissingPerm(node, 'can_delete', ctx))
            return
        try {
            if ((await events.emitAsync('deleting', { node, ctx }))?.isDefaultPrevented())
                return ctx.status = HTTP_FAILED_DEPENDENCY
            await rm(source, { recursive: true })
            void setCommentFor(source, '') // necessary only to clean a possible descript.ion or kvstorage
            return ctx.status = HTTP_OK
        } catch (e: any) {
            ctx.body = String(e)
            return ctx.status = HTTP_SERVER_ERROR
        }
    }
    if (node.default && path.endsWith('/') && !get) { // final/ needed on browser to make resource urls correctly with html pages
        const found = await urlToNode(node.default, ctx, node)
        if (found && /\.html?/i.test(node.default))
            ctx.state.considerAsGui = true
        node = found ?? node
    }
    if (get === 'icon')
        return serveFile(ctx, node.icon || '|') // pipe to cause not-found
    if (!nodeIsFolder(node))
        return node.url ? ctx.redirect(node.url)
            : !node.source ? sendErrorPage(ctx, HTTP_METHOD_NOT_ALLOWED) // !dir && !source is not supported at this moment
            : !statusCodeForMissingPerm(node, 'can_read', ctx) ? serveFileNode(ctx, node) // all good
            : ctx.status !== HTTP_UNAUTHORIZED ? null // all errors don't need extra handling, except unauthorized
            : detectBasicAgent(ctx) ? (ctx.set('WWW-Authenticate', 'Basic'), sendErrorPage(ctx))
            : ctx.query.dl === undefined && (ctx.state.serveApp = true) && serveFrontendFiles(ctx, next)
    if (!path.endsWith('/'))
        return ctx.redirect(ctx.state.revProxyPath + ctx.originalUrl.replace(/(\?|$)/, '/$1')) // keep query-string, if any
    if (statusCodeForMissingPerm(node, 'can_list', ctx)) {
        if (ctx.status === HTTP_FORBIDDEN)
            return sendErrorPage(ctx, HTTP_FORBIDDEN)
        // detect if we are dealing with a download-manager, as it may need basic authentication, while we don't want it on browsers
        const { authenticate } = ctx.query
        const downloadManagerDetected = /DAP|FDM|[Mm]anager/.test(ctx.get('user-agent'))
        if (downloadManagerDetected || authenticate || detectBasicAgent(ctx))
            return ctx.set('WWW-Authenticate', authenticate || 'Basic') // basic authentication for DMs getting the folder as a zip
        ctx.state.serveApp = true
        return serveFrontendFiles(ctx, next)
    }
    ctx.set({ server: `HFS ${VERSION} ${BUILD_TIMESTAMP}` })
    return get === 'zip' ? zipStreamFromFolder(node, ctx)
        : get === 'list' ? sendFolderList(node, ctx)
        : (basicWeb(ctx, node) || serveFrontendFiles(ctx, next))
}

async function sendFolderList(node: VfsNode, ctx: Koa.Context) {
    if ((await events.emitAsync('getList', { node, ctx }))?.isDefaultPrevented())
        return
    let { depth=0, folders, prepend } = ctx.query
    ctx.type = 'text'
    if (prepend === undefined || prepend === '*') { // * = force auto-detection even if we have baseUrl set
        const { URL } = ctx
        const base = prepend === undefined && baseUrl.get()
            || URL.protocol + '//' + URL.host + ctx.state.revProxyPath
        prepend = base + pathEncode(decodeURI(ctx.path)) // redo the encoding our way, keeping unicode chars unchanged
    }
    const walker = walkNode(node, { ctx, depth: depth === '*' ? Infinity : Number(depth), parallelizeRecursion: false })
    ctx.body = asyncGeneratorToReadable(filterMapGenerator(walker, async el => {
        const isFolder = nodeIsFolder(el)
        return !folders && isFolder ? undefined
            : prepend + pathEncode(getNodeName(el)) + (isFolder ? '/' : '') + '\n'
    }))
}

async function calcHash(fn: string, limit=Infinity) {
    const hash = XXH.h32()
    const stream = new Transform({
        transform(chunk, enc, done) {
            hash.update(chunk)
            done()
        }
    })
    fs.createReadStream(fn, { end: limit - 1 }).pipe(stream)
    console.debug('hashing', fn)
    await once(stream, 'finish')
    console.debug('hashed', fn)
    return hash.digest().toString(16)
}

declare module "koa" {
    interface DefaultState {
        serveApp?: boolean // please, serve the frontend app
        uploadPath?: string // current one
        uploads?: string[] // in case of request with potentially multiple uploads (POST), we register all filenames (no full path)
    }
}
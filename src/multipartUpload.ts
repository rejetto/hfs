import Koa from 'koa'
import Busboy from 'busboy'
import { hasPermission, urlToNode, VfsNodeWithPath } from './vfs'
import { dirname } from 'path'
import { uploadWriter } from './upload'
import { HTTP_BAD_REQUEST, HTTP_FOOL } from './cross-const'
import { onFirstEvent } from './first'
import { makeMatcher, try_ } from './cross'
import { defineConfig } from './config'

export async function handleMultipartUpload(ctx: Koa.Context, node: VfsNodeWithPath) {
    if (ctx.request.type !== 'multipart/form-data')
        return ctx.status = HTTP_BAD_REQUEST
    if (isCrossOriginBrowserRequest()) {
        ctx.set('Connection', 'close') // the rejected multipart body is intentionally left unread
        ctx.body = "Cross-origin multipart upload blocked"
        return ctx.status = HTTP_FOOL
    }
    ctx.state.uploads = []
    const locks: Promise<string>[] = []
    const fileJobs: Promise<any>[] = []
    const errors: string[] = []
    const bb = try_(() => Busboy({ headers: ctx.req.headers, preservePath: true }), e => {
        ctx.body = String(e) // busboy validates multipart headers at construction time, so malformed requests must stop here as 400
        ctx.status = HTTP_BAD_REQUEST
    })
    if (!bb) return
    bb.on('field', (name: string) => {
        if (name === 'upload')
            errors.push('empty filename')
    })
    bb.on('file', (_field, file, info) => {
        const fn = info.filename || ''
        if (!fn) {
            errors.push('empty filename')
            fileJobs.push(drainStream(file))
            return
        }
        ctx.state.uploadPath = decodeURI(ctx.path) + fn
        ctx.state.uploads!.push(fn)
        file.pause()
        fileJobs.push(handleFile(file, fn))
    })
    bb.on('error', (err: Error) => {
        console.warn("Couldn't parse POST requests:", String(err))
        ctx.status = HTTP_BAD_REQUEST
    })
    ctx.req.pipe(bb)
    await new Promise(res => onFirstEvent(bb, ['finish','error'], res)) // parser errors are handled above as 400 and must complete the request without rejecting
    await Promise.all(fileJobs)
    if (!ctx.state.uploads?.length) {
        if (!errors.length)
            errors.push('no files')
        ctx.status = HTTP_BAD_REQUEST
    }
    const uris = await Promise.all(locks)
    ctx.body = errors.length ? { uris, errors } : { uris }
    return

    async function handleFile(file: NodeJS.ReadableStream, fn: string) {
        try { // it is still possible to allow upload in a folder and block in a subfolder, so check for it
            const ret = !await subfolderBlocksUpload(fn) && uploadWriter(node, ctx.path, fn, ctx)
            if (!ret)
                return drainStream(file)
            locks.push(ret.lockMiddleware)
            file.pipe(ret)
            file.resume()
        }
        catch (e) {
            console.warn("Couldn't handle uploaded file:", String(e))
            file.resume()
        }
    }

    function drainStream(stream: NodeJS.ReadableStream) {
        stream.resume()
        return new Promise(res => onFirstEvent(stream, ['end','close','error'], res))
    }

    function isCrossOriginBrowserRequest() {
        if (ctx.get('x-hfs-anti-csrf'))
            return false
        const origin = ctx.get('origin')
        if (origin && origin !== 'null' && allowedUploadOrigin.compiled()(origin))
            return false
        const fetchSite = ctx.get('sec-fetch-site')
        if (fetchSite)
            return fetchSite !== 'same-origin' && fetchSite !== 'none'
        if (!origin)
            return false // missing browser metadata preserves non-browser and legacy upload clients
        // compare hosts because TLS termination can make the public and internal protocols differ
        return try_(() => new URL(origin).host.toLowerCase() !== ctx.host.toLowerCase(),
            () => true)
    }

    async function subfolderBlocksUpload(fn: string) {
        const prefix = dirname(fn.replaceAll('\\', '/'))
        if (prefix === '.') // no subdir
            return false
        const subfolderNode = await urlToNode(prefix + '/', ctx, node, { allowMissing: true }) // final slash = explicitly a folder even if it doesn't exist on disk
        return subfolderNode && !hasPermission(subfolderNode, 'can_upload', ctx)
    }
}

const allowedUploadOrigin = defineConfig('allowed_upload_origin', '', mask => makeMatcher(mask, false, false))

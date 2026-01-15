import Koa from 'koa'
import Busboy from 'busboy'
import { once } from 'events'
import { hasPermission, urlToNode, VfsNode } from './vfs'
import { dirname } from 'path'
import { uploadWriter } from './upload'
import { HTTP_BAD_REQUEST } from './cross-const'
import { onFirstEvent } from './first'

export async function handleMultipartUpload(ctx: Koa.Context, node: VfsNode) {
    if (ctx.request.type !== 'multipart/form-data')
        return ctx.status = HTTP_BAD_REQUEST
    ctx.state.uploads = []
    const locks: Promise<string>[] = []
    const fileJobs: Promise<any>[] = []
    const errors: string[] = []
    const bb = Busboy({ headers: ctx.req.headers, preservePath: true })
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
    await once(bb, 'finish')
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

    async function subfolderBlocksUpload(fn: string) {
        const prefix = dirname(fn.replaceAll('\\', '/'))
        if (prefix === '.') // no subdir
            return false
        const subfolderNode = await urlToNode(prefix + '/', ctx, node, true) // final slash = explicitly a folder even if it doesn't exist on disk
        return subfolderNode && !hasPermission(subfolderNode, 'can_upload', ctx)
    }
}

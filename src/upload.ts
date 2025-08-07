import { getNodeByName, statusCodeForMissingPerm, VfsNode } from './vfs'
import Koa from 'koa'
import {
    HTTP_CONFLICT, HTTP_FOOL, HTTP_INSUFFICIENT_STORAGE, HTTP_RANGE_NOT_SATISFIABLE, HTTP_BAD_REQUEST, HTTP_NO_CONTENT,
    HTTP_PRECONDITION_FAILED, MTIME_CHECK,
} from './const'
import { basename, dirname, extname, join } from 'path'
import fs from 'fs'
import {
    dirTraversal, loadFileAttr, pendingPromise, storeFileAttr, try_, createStreamLimiter, pathEncode,
    enforceFinal, Timeout,
} from './misc'
import { defineConfig } from './config'
import { getDiskSpaceSync } from './util-os'
import { disconnect, updateConnection, updateConnectionForCtx } from './connections'
import { roundSpeed } from './throttler'
import { getCurrentUsername } from './auth'
import { setCommentFor } from './comments'
import _ from 'lodash'
import events from './events'
import { rm, rename, utimes } from 'fs/promises'
import { expiringCache } from './expiringCache'
import { onProcessExit } from './first'

export const deleteUnfinishedUploadsAfter = defineConfig<undefined|number>('delete_unfinished_uploads_after', 86_400)
export const minAvailableMb = defineConfig('min_available_mb', 100)
export const dontOverwriteUploading = defineConfig('dont_overwrite_uploading', true)

const waitingToBeDeleted: Record<string, {
    timeout: Timeout, // pending action
    expires: number, // when
    mtime?: any
}> = {}
onProcessExit(() => {
    if (!Object.keys(waitingToBeDeleted).length) return
    console.log("removing unfinished uploads")
    for (const path in waitingToBeDeleted)
        try { fs.rmSync(path, { force: true }) }
        catch {}
})

const ATTR_UPLOADER = 'uploader'

export function getUploadMeta(path: string) {
    return loadFileAttr(path, ATTR_UPLOADER)
}

function setUploadMeta(path: string, ctx: Koa.Context) {
    return storeFileAttr(path, ATTR_UPLOADER, {
        username: getCurrentUsername(ctx) || undefined,
        ip: ctx.ip,
    })
}

export function getUploadTempFor(fullPath: string) {
    return join(dirname(fullPath), 'hfs$upload-' + basename(fullPath).slice(-200))
}

const diskSpaceCache = expiringCache<ReturnType<typeof getDiskSpaceSync>>(3_000) // invalidate shortly
const uploadingFiles = new Map<string, { ctx: Koa.Context, size: number, got: number }>()
// stay sync because we use this function with formidable()
export function uploadWriter(base: VfsNode, baseUri: string, path: string, ctx: Koa.Context) {
    if (dirTraversal(path))
        return fail(HTTP_FOOL)
    if (statusCodeForMissingPerm(base, 'can_upload', ctx))
        return fail()
    const fullPath = join(base.source!, path)
    const already = uploadingFiles.get(fullPath) // this can be checked so early because this function is sync
    if (already) // if it's the same client, we tell to retry later
        return fail(HTTP_CONFLICT, ctx.query.id && ctx.query.id === already.ctx.query.id ? 'retry' : 'already uploading')
    const dir = dirname(fullPath)
    // enforce minAvailableMb
    const min = minAvailableMb.get() * (1 << 20)
    const {simulate} = ctx.query // `simulate` is used to get the same error but with an empty body, so that the request is processed quickly
    const contentLength = Number(simulate || ctx.headers["content-length"])
    const isPartial = ctx.query.partial !== undefined // while the presence of "partial" conveys the upload is split...
    const stillToWrite = Math.max(contentLength, Number(ctx.query.partial) || 0) // ...the number is used to tell how much space we need (fullSize - offset)
    if (isNaN(stillToWrite)) {
        if (min)
            return fail(HTTP_BAD_REQUEST, 'content-length mandatory')
    }
    else
        try {
            // refer to the source of the closest node that actually belongs to the vfs, so that cache is more effective
            let closestVfsNode = base // if base=root, there's no parent and no original
            while (closestVfsNode?.parent && !closestVfsNode.original)
                closestVfsNode = closestVfsNode.parent! // if it's not original, it surely has a parent
            const dirToCheck = closestVfsNode!.source!
            const res = diskSpaceCache.try(dirToCheck, () => getDiskSpaceSync(dirToCheck))
            if (!res) throw 'miss'
            const { free } = res
            if (typeof free !== 'number' || isNaN(free))
                throw JSON.stringify(res)
            const reservedSpace = _.sumBy(Array.from(uploadingFiles.values()), x => x.size - x.got)
            if (stillToWrite > free - (min || 0) - reservedSpace)
                return fail(HTTP_INSUFFICIENT_STORAGE)
        }
        catch(e: any) { // warn, but let it through
            console.warn("can't check disk size:", e.message || String(e))
        }
    // optionally 'skip'
    if (ctx.query.existing === 'skip' && fs.existsSync(fullPath))
        return fail(HTTP_CONFLICT, 'exists')
    let overwriteRequestedButForbidden = false
    const mtime = Number(ctx.query.mtime) || 0
    try {
        // if upload creates a folder, then add meta to it too
        if (!dir.endsWith(':\\') && fs.mkdirSync(dir, { recursive: true }))
            setUploadMeta(dir, ctx)
        // use temporary name while uploading
        const tempName = getUploadTempFor(fullPath)
        const stats = try_(() => fs.statSync(tempName))
        const resumableSize = stats?.size || 0
        // checks for resume feature
        const par = String(ctx.query.resume || '')
        const resume = parseInt(par) || 0
        const strictResume = par.at(-1) === '!'
        if (resume > resumableSize || resume < 0)
            return fail(HTTP_RANGE_NOT_SATISFIABLE)
        const resumeInfo = resumableSize && waitingToBeDeleted[tempName]
        if (strictResume) // frontend asked to be notified about resumable uploads
            if (resumableSize > resume && (!resumeInfo || resumeInfo.mtime === mtime)) {
                ctx.set('x-size', String(resumableSize))
                if (!resumeInfo) // if unavailable, the client can request hashing
                    ctx.set(MTIME_CHECK, 'not-available')
                return fail(HTTP_PRECONDITION_FAILED)
            }
        // append if resuming
        if (!resume && stats)
            fs.unlinkSync(tempName)
        const writeStream = createStreamLimiter(contentLength ?? Infinity)
        const fullSize = stillToWrite + resume
        ctx.state.uploadDestinationPath = tempName
        // allow plugins to mess with the write-stream, because the read-stream can be complicated in case of multipart
        const obj = { ctx, writeStream, uri: '' }
        const resEvent = events.emit('uploadStart', obj)
        if (resEvent?.isDefaultPrevented()) return

        const fileStream = fs.createWriteStream(tempName, resume ? { flags: 'r+', start: resume } : undefined)
        writeStream.on('error', e => {
            releaseFile()
            console.debug(e)
        })
        writeStream.pipe(fileStream)
        Object.assign(obj, { fileStream })
        trackProgress()
        cancelDeletion(tempName)
        const tracked = { ctx, got: 0, size: stillToWrite }
        uploadingFiles.set(fullPath, tracked)
        console.debug('upload started')
        // the file stream doesn't have an event for data being written, so we use 'data' of its feeder, which happens before, so we postpone a bit, trying to have a fresher number
        writeStream.on('data', () => setTimeout(() => tracked.got = bytesGot()))

        const lockMiddleware = pendingPromise<string>() // expose outside, to let know when all operations stopped
        writeStream.once('close', async () => {
            try {
                ctx.state.uploadSize = bytesGot() // in case content-length is not specified
                await new Promise(res => fileStream.close(res)) // this only seems necessary on Windows
                if (simulate)
                    return rm(tempName).catch(() => {})
                if (ctx.isAborted()) { // in the very unlikely case the connection is interrupted between last-byte and here, we still consider it unfinished, as the client had no way to know, and will resume, but it would get an error if we finish the process
                    const sec = deleteUnfinishedUploadsAfter.get()
                    return _.isNumber(sec) && delayedDelete(tempName, sec)
                }
                if (isPartial) // we are supposed to leave the unfinished upload as it is, with its temp name
                    return ctx.status = HTTP_NO_CONTENT // lockMiddleware contains an empty string, so we must take care of the status
                let dest = fullPath // final destination, considering numbering if necessary
                if (dontOverwriteUploading.get() && !await overwriteAnyway() && fs.existsSync(dest)) {
                    if (overwriteRequestedButForbidden) {
                        await rm(tempName).catch(console.warn)
                        releaseFile()
                        return fail() // status code set by overwriteAnyway
                    }
                    const ext = extname(dest)
                    const base = dest.slice(0, -ext.length || Infinity)
                    let i = 1
                    do dest = `${base} (${i++})${ext}`
                    while (fs.existsSync(dest))
                }
                try {
                    await rename(tempName, dest)
                    if (mtime) // so we use it to touch the file
                        await utimes(dest, Date.now() / 1000, mtime / 1000)
                    cancelDeletion(tempName) // not necessary, as deletion's failure is silent, but still
                    ctx.state.uploadDestinationPath = dest
                    void setUploadMeta(dest, ctx)
                    if (ctx.query.comment)
                        void setCommentFor(dest, String(ctx.query.comment))
                    obj.uri = enforceFinal('/', baseUri) + pathEncode(basename(dest))
                    events.emit('uploadFinished', obj)
                    console.debug("upload finished", dest)
                    if (resEvent) for (const cb of resEvent)
                        if (_.isFunction(cb))
                            cb(obj)
                }
                catch (err: any) {
                    void setUploadMeta(tempName, ctx)
                    console.error("couldn't rename temp to", dest, String(err))
                }
            }
            finally {
                releaseFile()
                lockMiddleware.resolve(obj.uri)
            }
        })
        return Object.assign(obj.writeStream, { lockMiddleware })

        function trackProgress() {
            let lastGot = 0
            let lastGotTime = 0
            Object.assign(ctx.state, { opTotal: fullSize, opOffset: resume / fullSize, opProgress: 0 })
            const conn = updateConnectionForCtx(ctx)
            if (!conn) return
            const h = setInterval(() => {
                const now = Date.now()
                const got = bytesGot()
                const inSpeed = roundSpeed((got - lastGot) / (now - lastGotTime))
                lastGot = got
                lastGotTime = now
                updateConnection(conn, { inSpeed, got }, { opProgress: (resume + got) / fullSize })
            }, 1000)
            writeStream.once('close', () => clearInterval(h) )
        }

        function bytesGot() {
            return fileStream.bytesWritten + fileStream.writableLength
        }
    }
    catch (e: any) {
        releaseFile()
        throw e
    }

    async function overwriteAnyway() {
        if (ctx.query.existing !== 'overwrite') return false
        const n = await getNodeByName(path, base)
        if (n && !statusCodeForMissingPerm(n, 'can_delete', ctx)) return true
        overwriteRequestedButForbidden = true
        return false
    }

    function delayedDelete(path: string, secs: number) {
        clearTimeout(waitingToBeDeleted[path]?.timeout)
        return waitingToBeDeleted[path] = {
            mtime,
            expires: Date.now() + secs * 1000,
            timeout: setTimeout(() => {
                delete waitingToBeDeleted[path]
                rm(path).catch(() => {})
            }, secs * 1000)
        }
    }

    function cancelDeletion(path: string) {
        clearTimeout(waitingToBeDeleted[path]?.timeout)
        delete waitingToBeDeleted[path]
    }

    function releaseFile() {
        uploadingFiles.delete(fullPath)
    }

    function fail(status=ctx.status, msg?: string) {
        console.debug('upload failed', status, msg||'')
        ctx.status = status
        if (msg)
            ctx.body = msg
        if (status >= 400 // with other codes Chrome will report ERR_CONNECTION_RESET
        && !ctx.get('x-hfs-wait')) // you can disable the following behavior
            setTimeout(() => disconnect(ctx), 200) // don't wait, if the upload is still in progress
    }
}

declare module "koa" {
    interface DefaultState {
        uploadDestinationPath?: string
        uploadSize?: number
    }
}
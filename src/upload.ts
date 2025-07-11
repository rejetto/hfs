import { getNodeByName, statusCodeForMissingPerm, VfsNode } from './vfs'
import Koa from 'koa'
import {
    HTTP_CONFLICT, HTTP_FOOL, HTTP_INSUFFICIENT_STORAGE, HTTP_RANGE_NOT_SATISFIABLE, HTTP_BAD_REQUEST,
    UPLOAD_RESUMABLE, UPLOAD_REQUEST_STATUS, UPLOAD_RESUMABLE_HASH, HTTP_NO_CONTENT, HTTP_NOT_MODIFIED,
} from './const'
import { basename, dirname, extname, join } from 'path'
import fs from 'fs'
import {
    dirTraversal, loadFileAttr, pendingPromise, storeFileAttr, try_, createStreamLimiter, pathEncode,
    enforceFinal, Timeout, with_, parseFile
} from './misc'
import { notifyClient } from './frontEndApis'
import { defineConfig } from './config'
import { getDiskSpaceSync } from './util-os'
import { disconnect, updateConnection, updateConnectionForCtx } from './connections'
import { roundSpeed } from './throttler'
import { getCurrentUsername } from './auth'
import { setCommentFor } from './comments'
import _ from 'lodash'
import events from './events'
import { rm } from 'fs/promises'
import { expiringCache } from './expiringCache'
import { onProcessExit } from './first'
import { once, Transform } from 'stream'
import { utimes } from 'node:fs/promises'
import XXH from 'xxhashjs'

export const deleteUnfinishedUploadsAfter = defineConfig<undefined|number>('delete_unfinished_uploads_after', 86_400)
export const minAvailableMb = defineConfig('min_available_mb', 100)
export const dontOverwriteUploading = defineConfig('dont_overwrite_uploading', true)

const waitingToBeDeleted: Record<string, { timeout: Timeout, expires: number, mtimeMs?: number, giveBack?: any }> = {}
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

const diskSpaceCache = expiringCache<ReturnType<typeof getDiskSpaceSync>>(3_000) // invalidate shortly
const uploadingFiles = new Map<string, { ctx: Koa.Context, size: number, got: number }>()
// stay sync because we use this function with formidable()
export function uploadWriter(base: VfsNode, baseUri: string, path: string, ctx: Koa.Context) {
    if (dirTraversal(path))
        return fail(HTTP_FOOL)
    if (statusCodeForMissingPerm(base, 'can_upload', ctx)) {
        if (!ctx.get('x-hfs-wait')) { // you can disable the following behavior
            // avoid waiting hours for just an error
            const t = setTimeout(() => disconnect(ctx), 30_000)
            ctx.res.on('finish', () => clearTimeout(t))
        }
        return fail()
    }
    // enforce minAvailableMb
    const fullPath = join(base.source!, path)
    const already = uploadingFiles.get(fullPath) // this can be checked so early because this function is sync
    if (already) // if it's the same client, we tell to retry later
        return fail(ctx.query.notifications && ctx.query.notifications === already.ctx.query.notifications ? HTTP_NOT_MODIFIED : HTTP_CONFLICT,
            'already uploading')
    const dir = dirname(fullPath)
    const min = minAvailableMb.get() * (1 << 20)
    const contentLength = Number(ctx.headers["content-length"])
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
            const statDir = closestVfsNode!.source!
            const res = diskSpaceCache.try(statDir, () => getDiskSpaceSync(statDir))
            if (!res) throw 'miss'
            const { free } = res
            if (typeof free !== 'number' || isNaN(free))
                throw ''
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
    try {
        const sendCurrentSize = _.debounce(() => notifyClient(ctx, UPLOAD_RESUMABLE, { path, written: getCurrentSize() }), 1000, { maxWait: 1000 })
        // if upload creates a folder, then add meta to it too
        if (!dir.endsWith(':\\') && fs.mkdirSync(dir, { recursive: true }))
            setUploadMeta(dir, ctx)
        // use temporary name while uploading
        const keepName = basename(fullPath).slice(-200)
        const firstTempName = join(dir, 'hfs$upload-' + keepName)
        const altTempName = join(dir, 'hfs$upload2-' + keepName) // this file makes sense only while smaller than firstTempName
        const splitAndPreserving = ctx.query.preserveTempFile // frontend knows about existing temp that can be resumed, but it is not resuming that, but instead it is continuing split-uploading on alternative temp file
        let tempName = splitAndPreserving ? altTempName : firstTempName
        const stats = try_(() => fs.statSync(tempName))
        const resumableSize = stats?.size || 0 // we use size to even when user has not required resume, yet, to notify frontend of the possibility
        const firstResumableStats = tempName === firstTempName ? stats : try_(() => fs.statSync(firstTempName))
        let resumableTempName = resumableSize > 0 ? tempName : undefined
        if (resumableTempName)
            tempName = altTempName
        // checks for resume feature
        let resume = Number(ctx.query.resume)
        if (resume > resumableSize)
            return fail(HTTP_RANGE_NOT_SATISFIABLE)
        // warn frontend about resume possibility
        let resumeInfo = resumableTempName ? waitingToBeDeleted[resumableTempName] : undefined
        if (resumeInfo?.mtimeMs && resumeInfo?.mtimeMs !== try_(() => fs.statSync(resumableTempName!).mtimeMs)) // outdated?
            resumeInfo = undefined
        if (!resume)
            with_(resumableTempName, async x => {
                notifyClient(ctx, UPLOAD_RESUMABLE, !x ? { path } : {
                    path,
                    size: resumableSize,
                    // a resumable file exists without a record? then we record it (delayedDelete), plus we provide a hash ASAP, since there's no previous giveBack to compare with
                    ...resumeInfo || _.omit(delayedDelete(path, deleteUnfinishedUploadsAfter.get() || 0), 'giveBack'), // giveBack makes sense only if coming from resumeObject
                    timeout: undefined // this entry is here to remove the property copied in the previous line
                })
                if (x && !resumeInfo)
                    notifyClient(ctx, UPLOAD_RESUMABLE_HASH, { path, hash: await parseFile(x!, calcHash) })  // negligible memory leak
            })
        // append if resuming
        const resuming = resume && resumableTempName
        if (!resuming)
            resume = 0
        const writeStream = createStreamLimiter(contentLength ?? Infinity)
        if (resume && resumableTempName && !splitAndPreserving) { // we want to resume the firstTempName, actually
            fs.rm(altTempName, () => {})
            tempName = resumableTempName
        }
        let isWritingSecondFile = tempName === altTempName
        const fullSize = stillToWrite + resume
        ctx.state.uploadDestinationPath = tempName
        // allow plugins to mess with the write-stream, because the read-stream can be complicated in case of multipart
        const obj = { ctx, writeStream, uri: '' }
        const resEvent = events.emit('uploadStart', obj)
        if (resEvent?.isDefaultPrevented()) return

        const fileStream = resume && resumableTempName ? fs.createWriteStream(resumableTempName, { flags: 'r+', start: resume })
            : fs.createWriteStream(tempName)
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
        writeStream.on('data', () => setTimeout(checkIfNewUploadBecameLargerThanResumable))

        const lockMiddleware = pendingPromise<string>() // expose when all operations stopped
        writeStream.once('close', async () => {
            try {
                ctx.state.uploadSize = bytesGot() // in case content-length is not specified
                await new Promise(res => fileStream.close(res)) // this only seems necessary on Windows
                if (ctx.isAborted()) { // in the very unlikely case the connection is interrupted between last-byte and here, we still consider it unfinished, as the client had no way to know, and will resume, but it would get an error if we finish the process
                    if (isWritingSecondFile) // we don't want to be left with 2 temp files
                        return rm(altTempName).catch(console.warn)
                    const sec = deleteUnfinishedUploadsAfter.get()
                    return _.isNumber(sec) && delayedDelete(tempName, sec)
                }
                if (isPartial) // we are supposed to leave the upload as unfinished, with the temp name
                    return ctx.status = HTTP_NO_CONTENT // lockMiddleware contains an empty string, so we must take care of the status
                let dest = fullPath
                if (dontOverwriteUploading.get() && !await overwriteAnyway() && fs.existsSync(dest)) {
                    if (overwriteRequestedButForbidden) {
                        await rm(tempName).catch(console.warn)
                        releaseFile()
                        return fail()
                    }
                    const ext = extname(dest)
                    const base = dest.slice(0, -ext.length || Infinity)
                    let i = 1
                    do dest = `${base} (${i++})${ext}`
                    while (fs.existsSync(dest))
                }
                try {
                    fs.renameSync(tempName, dest) // sync to avoid race conditions with checkIfNewUploadBecameLargerThanResumable
                    const t = Number(ctx.query.giveBack) // we know giveBack contains lastModified in ms
                    if (t) // so we use it to touch the file
                        await utimes(dest, Date.now() / 1000, t / 1000)
                    cancelDeletion(tempName) // not necessary, as deletion's failure is silent, but still
                    if (isWritingSecondFile) { // we've been using altTempName, but now we're done, so we can delete firstTempName
                        cancelDeletion(firstTempName)
                        await rm(firstTempName) // wait, so the client can count on the temp-file being gone
                    }
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

        function getCurrentSize() {
            return bytesGot() + resume
        }

        function bytesGot() {
            return fileStream.bytesWritten + fileStream.writableLength
        }

        function checkIfNewUploadBecameLargerThanResumable() {
            tracked.got = bytesGot()
            sendCurrentSize() // keep the client updated in case it needs to resume on disconnection
            if (isWritingSecondFile && getCurrentSize() > firstResumableStats?.size!)
                try { // better be sync here, as we don't want the upload to finish in the middle of the rename
                    fs.renameSync(tempName, firstTempName) // try to rename $upload2 to $upload, overwriting
                    tempName = firstTempName
                    isWritingSecondFile = false
                    resumableTempName = undefined
                    notifyClient(ctx, UPLOAD_RESUMABLE, { path }) // no longer resumable
                }
                catch{}
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
            giveBack: ctx.query.giveBack,
            mtimeMs: try_(() => fs.statSync(path).mtimeMs),
            expires: Date.now() + secs * 1000,
            timeout: setTimeout(() => {
                delete waitingToBeDeleted[path]
                void rm(path)
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
        notifyClient(ctx, UPLOAD_REQUEST_STATUS, { path, status }) // allow browsers to detect failure while still sending body
    }
}

declare module "koa" {
    interface DefaultState {
        uploadDestinationPath?: string
        uploadSize?: number
    }
}
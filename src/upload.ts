import { getNodeByName, statusCodeForMissingPerm, VfsNode } from './vfs'
import Koa from 'koa'
import {
    HTTP_CONFLICT, HTTP_FOOL, HTTP_PAYLOAD_TOO_LARGE, HTTP_RANGE_NOT_SATISFIABLE, HTTP_BAD_REQUEST,
    UPLOAD_RESUMABLE, UPLOAD_STATUS,
} from './const'
import { basename, dirname, extname, join } from 'path'
import fs from 'fs'
import {
    Callback, dirTraversal, loadFileAttr, pendingPromise, storeFileAttr, try_, createStreamLimiter, pathEncode,
    enforceFinal
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
import { rename, rm } from 'fs/promises'
import { expiringCache } from './expiringCache'
import { onProcessExit } from './first'

export const deleteUnfinishedUploadsAfter = defineConfig<undefined|number>('delete_unfinished_uploads_after', 86_400)
export const minAvailableMb = defineConfig('min_available_mb', 100)
export const dontOverwriteUploading = defineConfig('dont_overwrite_uploading', true)

const waitingToBeDeleted: Record<string, ReturnType<typeof setTimeout>> = {}
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

// stay sync because we use this function with formidable()
const diskSpaceCache = expiringCache<ReturnType<typeof getDiskSpaceSync>>(3_000) // invalidate shortly
const uploadingFiles = new Set()
export function uploadWriter(base: VfsNode, baseUri: string, path: string, ctx: Koa.Context) {
    let fullPath = ''
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
    fullPath = join(base.source!, path)
    const dir = dirname(fullPath)
    const min = minAvailableMb.get() * (1 << 20)
    const reqSize = Number(ctx.headers["content-length"])
    if (isNaN(reqSize)) {
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
            if (reqSize > free - (min || 0))
                return fail(HTTP_PAYLOAD_TOO_LARGE)
        }
        catch(e: any) { // warn, but let it through
            console.warn("can't check disk size:", e.message || String(e))
        }
    // optionally 'skip'
    if (ctx.query.existing === 'skip' && fs.existsSync(fullPath))
        return fail(HTTP_CONFLICT, 'exists')
    if (uploadingFiles.has(fullPath))
        return fail(HTTP_CONFLICT, 'uploading')
    uploadingFiles.add(fullPath)
    let overwriteRequestedButForbidden = false
    try {
        // if upload creates a folder, then add meta to it too
        if (!dir.endsWith(':\\') && fs.mkdirSync(dir, { recursive: true }))
            setUploadMeta(dir, ctx)
        // use temporary name while uploading
        const keepName = basename(fullPath).slice(-200)
        const firstTempName = join(dir, 'hfs$upload-' + keepName)
        const altTempName = join(dir, 'hfs$upload2-' + keepName)
        const splitAndPreserving = ctx.query.preserveTempFile // frontend knows about existing temp that can be resumed, but it is not resuming that, but instead it is continuing split-uploading on alternative temp file
        let tempName = splitAndPreserving ? altTempName : firstTempName
        const stats = try_(() => fs.statSync(tempName))
        const resumableSize = stats?.size || 0 // we use size to even when user has not required resume, yet, to notify frontend of the possibility
        const resumableTempName = resumableSize > 0 && tempName
        if (resumableTempName)
            tempName = altTempName
        // checks for resume feature
        let resume = Number(ctx.query.resume)
        if (resume > resumableSize)
            return fail(HTTP_RANGE_NOT_SATISFIABLE)
        // warn frontend about resume possibility
        let resumableLost = false
        if (!resume && !resumableTempName)
            notifyClient(ctx, UPLOAD_RESUMABLE, { [path]: 0 })
        if (!resume && resumableTempName) {
            const timeout = 30
            notifyClient(ctx, UPLOAD_RESUMABLE, { [path]: resumableSize, expires: Date.now() + timeout * 1000 })
            delayedDelete(resumableTempName, timeout, () => // if user resumes, this upload is interrupted, and next upload will cancel this delayedDelete
                fs.rename(tempName, resumableTempName, err => { // try to rename $upload2 to $upload, overwriting
                    if (err) return
                    tempName = resumableTempName
                    resumableLost = true
                }) )
        }
        // append if resuming
        const resuming = resume && resumableTempName
        if (!resuming)
            resume = 0
        const writeStream = createStreamLimiter(reqSize ?? Infinity)
        if (resuming && !splitAndPreserving) {
            fs.rm(tempName, () => {})
            tempName = resumableTempName
        }
        cancelDeletion(tempName)
        ctx.state.uploadDestinationPath = tempName
        // allow plugins to mess with the write-stream, because the read-stream can be complicated in case of multipart
        const obj = { ctx, writeStream, uri: '' }
        const resEvent = events.emit('uploadStart', obj)
        if (resEvent?.isDefaultPrevented()) return

        const fileStream = resuming ? fs.createWriteStream(resumableTempName, { flags: 'r+', start: resume })
            : fs.createWriteStream(tempName)
        writeStream.on('error', e => {
            releaseFile()
            console.debug(e)
        })
        writeStream.pipe(fileStream)
        Object.assign(obj, { fileStream })
        trackProgress()

        const lockMiddleware = pendingPromise<string>() // outside we need to know when all operations stopped
        writeStream.once('close', async () => {
            try {
                await new Promise(res => fileStream.close(res)) // this only seem to be necessary on Windows
                if (ctx.req.aborted) { // doc says .aborted is deprecated, replaced by .destroyed, but in my tests the latter is true even for completed uploads, while .aborted is only for interrupted ones
                    if (resumableTempName && !resumableLost && !resuming) // we don't want to be left with 2 temp files
                        return rm(tempName)
                    const sec = deleteUnfinishedUploadsAfter.get()
                    return _.isNumber(sec) && delayedDelete(tempName, sec)
                }
                if (ctx.query.partial) return // this upload is partial, and we are supposed to leave the upload as unfinished, with the temp name
                let dest = fullPath
                if (dontOverwriteUploading.get() && !await overwriteAnyway() && fs.existsSync(dest)) {
                    if (overwriteRequestedButForbidden) {
                        await rm(tempName)
                        return fail()
                    }
                    const ext = extname(dest)
                    const base = dest.slice(0, -ext.length || Infinity)
                    let i = 1
                    do dest = `${base} (${i++})${ext}`
                    while (fs.existsSync(dest))
                }
                try {
                    await rename(tempName, dest)
                    cancelDeletion(tempName) // not necessary, as deletion's failure is silent, but still
                    if (splitAndPreserving) // we've been using altTempName, but now we're done, so we can delete firstTempName
                        delayedDelete(firstTempName, 0)
                    ctx.state.uploadDestinationPath = dest
                    setUploadMeta(dest, ctx)
                    if (ctx.query.comment)
                        void setCommentFor(dest, String(ctx.query.comment))
                    if (resumableTempName && !resuming) // this happens if user decided to not resume and the new upload finished before delayedDelete
                        rm(resumableTempName).catch(console.warn)
                    obj.uri = enforceFinal('/', baseUri) + pathEncode(basename(dest))
                    events.emit('uploadFinished', obj)
                    if (resEvent) for (const cb of resEvent)
                        if (_.isFunction(cb))
                            cb(obj)
                }
                catch (err: any) {
                    setUploadMeta(tempName, ctx)
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
            const opTotal = reqSize + resume
            Object.assign(ctx.state, { opTotal, opOffset: resume / opTotal, opProgress: 0 })
            const conn = updateConnectionForCtx(ctx)
            if (!conn) return
            const h = setInterval(() => {
                const now = Date.now()
                const got = fileStream.bytesWritten
                const inSpeed = roundSpeed((got - lastGot) / (now - lastGotTime))
                lastGot = got
                lastGotTime = now
                updateConnection(conn, { inSpeed, got }, { opProgress: (resume + got) / opTotal })
            }, 1000)
            writeStream.once('close', () => clearInterval(h) )
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

    function delayedDelete(path: string, secs: number, cb?: Callback) {
        clearTimeout(waitingToBeDeleted[path])
        waitingToBeDeleted[path] = setTimeout(() => {
            delete waitingToBeDeleted[path]
            fs.rm(path, () => cb?.())
        }, secs * 1000)
    }

    function cancelDeletion(path: string) {
        clearTimeout(waitingToBeDeleted[path])
        delete waitingToBeDeleted[path]
    }

    function releaseFile() {
        uploadingFiles.delete(fullPath)
    }

    function fail(status?: number, msg?: string) {
        console.debug('upload failed', status, msg)
        releaseFile()
        if (status)
            ctx.status = status
        if (msg)
            ctx.body = msg
        notifyClient(ctx, UPLOAD_STATUS, { [path]: ctx.status }) // allow browsers to detect failure while still sending body
    }
}

declare module "koa" {
    interface DefaultState {
        uploadDestinationPath?: string
    }
}
import { getNodeByName, hasPermission, statusCodeForMissingPerm, VfsNode } from './vfs'
import Koa from 'koa'
import { HTTP_CONFLICT, HTTP_FOOL, HTTP_PAYLOAD_TOO_LARGE, HTTP_RANGE_NOT_SATISFIABLE, HTTP_SERVER_ERROR } from './const'
import { basename, dirname, extname, join } from 'path'
import fs from 'fs'
import { Callback, dirTraversal, escapeHTML, loadFileAttr, pendingPromise, storeFileAttr, try_ } from './misc'
import { notifyClient } from './frontEndApis'
import { defineConfig } from './config'
import { getDiskSpaceSync } from './util-os'
import { disconnect, updateConnection, updateConnectionForCtx } from './connections'
import { roundSpeed } from './throttler'
import { getCurrentUsername } from './auth'
import { setCommentFor } from './comments'
import _ from 'lodash'
import events from './events'
import { rename } from 'fs/promises'

export const deleteUnfinishedUploadsAfter = defineConfig<undefined|number>('delete_unfinished_uploads_after', 86_400)
export const minAvailableMb = defineConfig('min_available_mb', 100)
export const dontOverwriteUploading = defineConfig('dont_overwrite_uploading', true)

const waitingToBeDeleted: Record<string, ReturnType<typeof setTimeout>> = {}

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
const cache: any = {}
export function uploadWriter(base: VfsNode, path: string, ctx: Koa.Context) {
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
    const fullPath = join(base.source!, path)
    const dir = dirname(fullPath)
    const min = minAvailableMb.get() * (1 << 20)
    const reqSize = Number(ctx.headers["content-length"])
    if (reqSize)
        try {
            if (!Object.hasOwn(cache, dir)) {
                cache[dir] = getDiskSpaceSync(dir)
                setTimeout(() => delete cache[dir], 3_000) // invalidate shortly
            }
            const { free } = cache[dir]
            if (typeof free !== 'number' || isNaN(free))
                throw ''
            if (reqSize > free - (min || 0))
                return fail(HTTP_PAYLOAD_TOO_LARGE)
        }
        catch(e: any) { // warn, but let it through
            console.warn("can't check disk size:", e.message || String(e))
        }
    if (ctx.query.existing === 'skip' && fs.existsSync(fullPath))
        return fail(HTTP_CONFLICT)
    if (fs.mkdirSync(dir, { recursive: true }))
        setUploadMeta(dir, ctx)
    const keepName = basename(fullPath).slice(-200)
    let tempName = join(dir, 'hfs$upload-' + keepName)
    const resumable = fs.existsSync(tempName) && tempName
    if (resumable)
        tempName = join(dir, 'hfs$upload2-' + keepName)
    let resume = Number(ctx.query.resume)
    const size = resumable && try_(() => fs.statSync(resumable).size)
    if (size === undefined) // stat failed
        return fail(HTTP_SERVER_ERROR)
    if (resume > size)
        return fail(HTTP_RANGE_NOT_SATISFIABLE)
    if (!resume && resumable) {
        const timeout = 30
        notifyClient(ctx, 'upload.resumable', { [path]: size, expires: Date.now() + timeout * 1000 })
        delayedDelete(resumable, timeout, () =>
            fs.rename(tempName, resumable, err => {
                if (!err)
                    tempName = resumable
            }) )
    }
    const resuming = resume && resumable
    if (!resuming)
        resume = 0
    const writeStream = resuming ? fs.createWriteStream(resumable, { flags: 'r+', start: resume })
        : fs.createWriteStream(tempName)
    if (resuming) {
        fs.rm(tempName, () => {})
        tempName = resumable
    }
    cancelDeletion(tempName)
    ctx.state.uploadDestinationPath = tempName
    trackProgress()
    const obj = { ctx, writeStream }
    events.emit('uploadStart', obj)
    const lockMiddleware = pendingPromise()
    writeStream.once('close', async () => {
        try {
            if (ctx.req.aborted) {
                if (resumable) // we don't want to be left with 2 temp files
                    return delayedDelete(tempName, 0)
                const sec = deleteUnfinishedUploadsAfter.get()
                return _.isNumber(sec) && delayedDelete(tempName, sec)
            }
            let dest = fullPath
            if (dontOverwriteUploading.get() && !await overwriteAnyway() && fs.existsSync(dest)) {
                const ext = extname(dest)
                const base = dest.slice(0, -ext.length || Infinity)
                let i = 1
                do dest = `${base} (${i++})${ext}`
                while (fs.existsSync(dest))
            }
            try {
                await rename(tempName, dest)
                ctx.state.uploadDestinationPath = dest
                setUploadMeta(dest, ctx)
                if (ctx.query.comment)
                    setCommentFor(dest, escapeHTML(String(ctx.query.comment)))
                if (resumable)
                    delayedDelete(resumable, 0)
                events.emit('uploadFinished', obj)
            }
            catch (err: any) {
                setUploadMeta(tempName, ctx)
                console.error("couldn't rename temp to", dest, String(err))
            }
        }
        finally {
            lockMiddleware.resolve()
        }
    })
    return Object.assign(obj.writeStream, {
        lockMiddleware
    })

    async function overwriteAnyway() {
        if (ctx.query.overwrite === undefined // legacy pre-0.52
        && ctx.query.existing !== 'overwrite') return
        const n = await getNodeByName(path, base)
        return n && hasPermission(n, 'can_delete', ctx)
    }

    function trackProgress() {
        let lastGot = 0
        let lastGotTime = 0
        const opTotal = reqSize + resume
        Object.assign(ctx.state, { op: 'upload', opTotal, opOffset: resume / opTotal, opProgress: 0 })
        const conn = updateConnectionForCtx(ctx)
        if (!conn) return
        const h = setInterval(() => {
            const now = Date.now()
            const got = writeStream.bytesWritten
            const inSpeed = roundSpeed((got - lastGot) / (now - lastGotTime))
            lastGot = got
            lastGotTime = now
            updateConnection(conn, { inSpeed, got }, { opProgress: (resume + got) / opTotal })
        }, 1000)
        writeStream.once('close', () => clearInterval(h) )
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

    function fail(status?: number) {
        if (status)
            ctx.status = status
        notifyClient(ctx, 'upload.status', { [path]: ctx.status }) // allow browsers to detect failure while still sending body
    }
}

declare module "koa" {
    interface DefaultState {
        uploadDestinationPath?: string
    }
}
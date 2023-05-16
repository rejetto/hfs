import { statusCodeForMissingPerm, VfsNode } from './vfs'
import Koa from 'koa'
import {
    HTTP_CONFLICT, HTTP_FOOL,
    HTTP_PAYLOAD_TOO_LARGE,
    HTTP_RANGE_NOT_SATISFIABLE,
    HTTP_SERVER_ERROR,
} from './const'
import { basename, dirname, extname, join } from 'path'
import fs from 'fs'
import { Callback, dirTraversal, try_ } from './misc'
import { notifyClient } from './frontEndApis'
import { defineConfig } from './config'
import { getFreeDiskSync } from './util-os'
import { socket2connection, updateConnection } from './connections'
import { roundSpeed } from './throttler'
import _ from 'lodash'

export const deleteUnfinishedUploadsAfter = defineConfig<undefined|number>('delete_unfinished_uploads_after', 86_400)
export const minAvailableMb = defineConfig('min_available_mb', 100)
const dontOverwriteUploading = defineConfig('dont_overwrite_uploading', false)

const waitingToBeDeleted: Record<string, ReturnType<typeof setTimeout>> = {}

export function uploadWriter(base: VfsNode, path: string, ctx: Koa.Context) {
    if (dirTraversal(path))
        return fail(HTTP_FOOL)
    if (statusCodeForMissingPerm(base, 'can_upload', ctx))
        return fail()
    const fullPath = join(base.source!, path)
    const dir = dirname(fullPath)
    const min = minAvailableMb.get() * (1 << 20)
    const reqSize = Number(ctx.headers["content-length"])
    if (reqSize)
        try {
            const free = getFreeDiskSync(dir)
            if (typeof free !== 'number' || isNaN(free))
                throw ''
            if (reqSize > getFreeDiskSync(dir) - (min || 0))
                return fail(HTTP_PAYLOAD_TOO_LARGE)
        }
        catch(e: any) {
            console.warn("can't check disk size:", e.message || String(e))
        }
    if (ctx.query.skipExisting && fs.existsSync(fullPath))
        return fail(HTTP_CONFLICT)
    fs.mkdirSync(dir, { recursive: true })
    const keepName = basename(fullPath).slice(-200)
    let tempName = join(dir, 'hfs$upload-' + keepName)
    const resumable = fs.existsSync(tempName) && tempName
    if (resumable)
        tempName = join(dir, 'hfs$upload2-' + keepName)
    const resume = Number(ctx.query.resume)
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
    const ret = resuming ? fs.createWriteStream(resumable, { flags: 'r+', start: resume })
        : fs.createWriteStream(tempName)
    if (resuming) {
        fs.rm(tempName, () => {})
        tempName = resumable
    }
    cancelDeletion(tempName)
    trackProgress()
    ret.once('close', () => {
        if (!ctx.req.aborted) {
            let dest = fullPath
            if (dontOverwriteUploading.get() && fs.existsSync(dest)) {
                const ext = extname(dest)
                const base = dest.slice(0, -ext.length)
                let i = 1
                do dest = `${base} (${i++})${ext}`
                while (fs.existsSync(dest))
            }
            return fs.rename(tempName, dest, err => {
                err && console.error("couldn't rename temp to", dest, String(err))
                if (resumable)
                    delayedDelete(resumable, 0)
            })
        }
        if (resumable) // we don't want to be left with 2 temp files
            return delayedDelete(tempName, 0)
        const sec = deleteUnfinishedUploadsAfter.get()
        if (typeof sec !== 'number') return
        delayedDelete(tempName, sec)
    })
    return ret

    function trackProgress() {
        let lastGot = 0
        let lastGotTime = 0
        const conn = socket2connection(ctx.socket)
        if (!conn) return ()=>{}
        ctx.state.uploadPath = ctx.path + path
        updateConnection(conn, { ctx })
        const h = setInterval(() => {
            const now = Date.now()
            const got = ret.bytesWritten
            const inSpeed = roundSpeed((got - lastGot) / (now - lastGotTime))
            lastGot = got
            lastGotTime = now
            updateConnection(conn, { inSpeed, got, uploadProgress: _.round(got / reqSize, 3) })
        }, 1000)
        ret.once('close', () => clearInterval(h) )
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

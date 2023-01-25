import { hasPermission, VfsNode } from './vfs'
import Koa from 'koa'
import {
    HTTP_FORBIDDEN,
    HTTP_PAYLOAD_TOO_LARGE,
    HTTP_RANGE_NOT_SATISFIABLE,
    HTTP_SERVER_ERROR,
    HTTP_UNAUTHORIZED
} from './const'
import { basename, dirname, join } from 'path'
import fs from 'fs'
import { Callback, try_ } from './misc'
import { notifyClient } from './frontEndApis'
import { defineConfig } from './config'
import { getFreeDiskSync } from './util-os'

export const deleteUnfinishedUploadsAfter = defineConfig('delete_unfinished_uploads_after')
export const minAvailableMb = defineConfig('min_available_mb', 100)

const waitingToBeDeleted: Record<string, ReturnType<typeof setTimeout>> = {}

export function uploadWriter(base: VfsNode, path: string, ctx: Koa.Context) {
    if (!base.source || !hasPermission(base, 'can_upload', ctx))
        return fail(base.can_upload === false ? HTTP_FORBIDDEN : HTTP_UNAUTHORIZED)
    const fullPath = join(base.source, path)
    const dir = dirname(fullPath)
    const min = minAvailableMb.get() * (1 << 20)
    const reqSize = Number(ctx.headers["content-length"])
    if (min && reqSize)
        try {
            if (reqSize > getFreeDiskSync(dir) - min)
                return fail(HTTP_PAYLOAD_TOO_LARGE)
        }
        catch(e) {
            console.warn("can't check disk size", String(e))
        }
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
    ret.on('close', () => {
        if (!ctx.req.aborted)
            return fs.rename(tempName, fullPath, err => {
                err && console.error("couldn't rename temp to", fullPath, String(err))
                if (resumable)
                    delayedDelete(resumable, 0)
            })
        if (resumable) // we don't want to be left with 2 temp files
            return delayedDelete(tempName, 0)
        const sec = deleteUnfinishedUploadsAfter.get()
        if (typeof sec !== 'number') return
        delayedDelete(tempName, sec)
    })
    return ret

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

    function fail(status: number) {
        ctx.status = status
        notifyClient(ctx, 'upload.status', { [path]: ctx.status }) // allow browsers to detect failure while still sending body
    }
}

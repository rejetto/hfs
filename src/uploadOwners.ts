import { KvStorage } from '@rejetto/kvstorage'
import Koa from 'koa'
import { CFG, randomId, HOUR, MINUTE } from './misc'
import { onProcessExit } from './first'
import { defineConfig } from './config'
import { getCurrentUsername } from './auth'
import events from './events'
import { VfsNode } from './vfs'

export interface UploadOwner {
    username?: string
    sessionId?: string
    ip?: string
    created: Date
}

export const ownUploadDeleteHours = defineConfig(CFG.own_upload_delete_hours, 24)
export const uploadOwners = new KvStorage<UploadOwner>({
    rewriteLater: true,
})

uploadOwners.open('upload-owners.kv').catch(e =>
    console.error("Upload owners won't work correctly", e))
onProcessExit(() => uploadOwners.close())

setInterval(() => {
    if (!uploadOwners.isOpen())
        return
    const keys = Array.from(uploadOwners.keys())
    for (const k of keys) {
        const owner = uploadOwners.getSync(k)
        if (owner && isExpired(owner))
            void uploadOwners.del(k)
    }
}, MINUTE)

events.on('checkVfsPermission', ({ node, perm, ctx }: { node: VfsNode, perm: string, ctx: Koa.Context }) => {
    if (perm !== 'can_delete' || !node.source)
        return
    const { vfsPath } = node
    if (!vfsPath || !ownUploadDeleteHours.get() || !uploadOwners.isOpen())
        return
    const owner = uploadOwners.getSync(cleanVfsPath(vfsPath))
    if (!owner)
        return
    if (isExpired(owner)) {
        deleteUploadOwner(vfsPath)
        return
    }
    const username = getCurrentUsername(ctx)
    const { sessionId } = owner
    if (sessionId && sessionId === ctx.session?.sessionId || username && owner.username === username)
        return 0
})

export function setUploadOwner(vfsPath: string, ctx: Koa.Context) {
    if (!uploadOwners.isOpen() || !ownUploadDeleteHours.get())
        return
    const username = getCurrentUsername(ctx) || undefined
    return uploadOwners.put(cleanVfsPath(vfsPath), {
        username,
        sessionId: username ? undefined : getSessionId(ctx),
        ip: ctx.ip,
        created: new Date(),
    })?.catch(e => {
        console.error("Couldn't store upload owner for", vfsPath, String(e.message || e))
    })
}

export async function moveUploadOwner(fromPath: string, toPath: string) {
    if (!uploadOwners.isOpen())
        return
    const from = cleanVfsPath(fromPath)
    const affected = Array.from(uploadOwners.keys()).filter(k => isSameOrInside(from, k))
    if (!affected.length)
        return
    const to = cleanVfsPath(toPath)
    const owners = affected.map(k => ({ k, owner: uploadOwners.getSync(k) }))
    // ownership is keyed by VFS path, so HFS moves must carry descendant upload records too
    await Promise.all(owners.map(({ k, owner }) => owner && uploadOwners.put(to + k.slice(from.length), owner)))
    await Promise.all(affected.map(k => uploadOwners.del(k)))
}

export function deleteUploadOwner(vfsPath: string) {
    if (uploadOwners.isOpen())
        // deleting a folder must clear ownership for uploaded files below it too
        for (const k of Array.from(uploadOwners.keys()).filter(k => isSameOrInside(cleanVfsPath(vfsPath), k)))
            void uploadOwners.del(k)
}

function isExpired(owner: UploadOwner) {
    const hours = ownUploadDeleteHours.get()
    return !hours || Number(owner.created) + hours * HOUR <= Date.now()
}

export function getSessionId(ctx: Koa.Context) {
    return ctx.session!.sessionId ||= randomId(30)
}

function cleanVfsPath(path: string) {
    return '/' + path.replace(/^\/+|\/+$/g, '')
}

function isSameOrInside(parent: string, path: string) {
    return path === parent || path.startsWith(parent + '/')
}

declare module "koa-session" {
    interface Session {
        sessionId?: string
    }
}

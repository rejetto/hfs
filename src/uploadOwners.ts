import { KvStorage } from '@rejetto/kvstorage'
import Koa from 'koa'
import { pathDecodeSegments, pathEncode, CFG, randomId, HOUR, MINUTE } from './misc'
import { onProcessExit } from './first'
import { defineConfig } from './config'
import { getCurrentUsername } from './auth'
import events from './events'
import { isSameFilePath, normalizeFilename, urlToNode, VfsNode } from './vfs'

export interface UploadOwner {
    username?: string
    sessionId?: string
    ip?: string
    created: Date
    unfinishedUntil?: number | null // continuation lifetime is independent of the configurable delete grant
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
        if (owner && isRecordExpired(owner))
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
        if (isRecordExpired(owner))
            void deleteUploadOwner(vfsPath)
        return
    }
    if (matchesOwner(owner, ctx))
        return 0
})

function matchesOwner(owner: UploadOwner, ctx: Koa.Context) {
    const username = getCurrentUsername(ctx)
    const { sessionId } = owner
    return Boolean(sessionId && sessionId === ctx.session?.sessionId || username && owner.username === username)
}

export function isUnfinishedUploadOwner(node: VfsNode, ctx: Koa.Context) {
    if (node.original || !node.vfsPath || !uploadOwners.isOpen()) return false
    const owner = uploadOwners.getSync(cleanVfsPath(node.vfsPath))
    return Boolean(owner && owner.unfinishedUntil !== undefined && !isRecordExpired(owner) && matchesOwner(owner, ctx))
}

export async function setUploadOwner(vfsPath: string, ctx: Koa.Context, expectedSource?: string, unfinishedUntil?: number | null) {
    if (!uploadOwners.isOpen() || unfinishedUntil === undefined && !ownUploadDeleteHours.get())
        return
    if (expectedSource && !await getNodeMatchingSource(vfsPath, ctx, expectedSource))
        return
    const username = getCurrentUsername(ctx) || undefined
    return uploadOwners.put(cleanVfsPath(vfsPath), {
        username,
        sessionId: username ? undefined : getSessionId(ctx),
        ip: ctx.ip,
        created: new Date(),
        unfinishedUntil,
    })?.catch(e => {
        console.error("Couldn't store upload owner for", vfsPath, String(e.message || e))
    })
}

export async function moveUploadOwner(fromPath: string, toPath: string, expectedSource?: string) {
    if (!uploadOwners.isOpen())
        return
    const from = cleanVfsPath(fromPath)
    const to = cleanVfsPath(toPath)
    const affected = Array.from(uploadOwners.keys()).filter(k => isSameOrInside(from, k))
    if (expectedSource && !await getNodeMatchingSource(toPath, undefined, expectedSource)) {
        await Promise.all(affected.map(k => uploadOwners.del(k)))
        return
    }
    if (to === from)
        return
    deleteUploadOwner(to) // overwriting with a non-uploaded file must not preserve the previous destination's delete grant
    if (!affected.length)
        return
    const owners = affected.map(k => ({ k, owner: uploadOwners.getSync(k) }))
    // ownership is keyed by VFS path, so HFS moves must carry descendant upload records too
    // an ordinary move must not carry the right to continue an upload at another path
    await Promise.all(owners.map(({ k, owner }) => owner && uploadOwners.put(to + k.slice(from.length), { ...owner, unfinishedUntil: undefined })))
    await Promise.all(affected.map(k => uploadOwners.del(k)))
}

export async function getNodeMatchingSource(vfsPath: string, ctx: Koa.Context | undefined, source: string) {
    const node = await urlToNode(vfsPath, ctx, undefined, { includeHidden: true })
    if (node?.source && await isSameFilePath(node.source, source))
        return node
}

export function deleteUploadOwner(vfsPath: string) {
    if (!uploadOwners.isOpen())
        return
    const path = cleanVfsPath(vfsPath)
    for (const k of uploadOwners.keys()) // deleting a folder must clear ownership for uploaded files below it too
        if (isSameOrInside(path, k))
            void uploadOwners.del(k)
}

function isExpired(owner: UploadOwner) {
    const hours = ownUploadDeleteHours.get()
    return !hours || Number(owner.created) + hours * HOUR <= Date.now()
}

function isRecordExpired(owner: UploadOwner) {
    return owner.unfinishedUntil === undefined ? isExpired(owner)
        : owner.unfinishedUntil !== null && owner.unfinishedUntil <= Date.now()
}

export function getSessionId(ctx: Koa.Context) {
    return ctx.session!.sessionId ||= randomId(30)
}

function cleanVfsPath(path: string) {
    return normalizeFilename(pathDecodeSegments('/' + path.replace(/^\/+|\/+$/g, ''), pathEncode))
}

function isSameOrInside(parent: string, path: string) {
    return path === parent || path.startsWith(parent + '/')
}

declare module "koa-session" {
    interface Session {
        sessionId?: string
    }
}

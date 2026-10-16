import { KvStorage } from '@rejetto/kvstorage'
import Koa from 'koa'
import { randomUUID } from 'node:crypto'
import { pathDecodeSegments, pathEncode, CFG, HOUR, MINUTE } from './misc'
import { onProcessExit } from './first'
import { defineConfig } from './config'
import { getCurrentUsername } from './auth'
import events from './events'
import { isSameFilePath, nodeStats, normalizeFilename, urlToNode, VfsNode } from './vfs'
import { basename, resolve } from 'path'
import { realpath, stat } from 'fs/promises'
import { realpathSync, Stats } from 'fs'
import { UPLOAD_TEMP_PREFIX } from './const'
import { ctxAdminAccess } from './adminApis'
import { getUploadMeta } from './upload'

export interface UploadOwner {
    username?: string
    sessionId?: string
    ip?: string
    created: Date
    unfinishedUntil?: number | null // continuation lifetime is independent of the configurable delete grant
    unfinishedSource?: string
}

const activeUploadOwners = new Map<string, UploadOwner>()

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

events.on('checkVfsPermission', grantUploadOwnerDelete)

export function grantUploadOwnerDelete({ node, perm, ctx }: { node: VfsNode, perm: string, ctx: Koa.Context }) {
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
}

function matchesOwner(owner: UploadOwner, ctx: Koa.Context) {
    const username = getCurrentUsername(ctx)
    const { sessionId } = owner
    return Boolean(sessionId && sessionId === ctx.session?.sessionId || username && owner.username === username)
}

export function registerActiveUpload(stats: Pick<Stats, 'dev' | 'ino'>, ctx: Koa.Context) {
    const key = `${stats.dev}:${stats.ino}`
    const username = getCurrentUsername(ctx) || undefined
    const owner = { username, sessionId: username ? undefined : getSessionId(ctx), created: new Date() }
    // inode ownership stays private across the final rename until its metadata has been stored
    activeUploadOwners.set(key, owner)
    return () => {
        // an aliased writer can replace this entry before an older stream finishes
        if (activeUploadOwners.get(key) === owner)
            activeUploadOwners.delete(key)
    }
}

export async function canAccessUnfinishedUpload(node: VfsNode, ctx: Koa.Context) {
    if (!node.source)
        return true
    // inode identity is only needed while an upload is active; ordinary listings prefetch their own stats
    if (activeUploadOwners.size) {
        let stats = await nodeStats(node)
        if (stats?.isDirectory())
            return true
        // Windows native directory entries omit inode identity used by active uploads
        if (stats && (stats.dev === undefined || stats.ino === undefined))
            stats = await stat(node.source).catch(() => undefined)
        const activeOwner = stats && activeUploadOwners.get(`${stats.dev}:${stats.ino}`)
        if (activeOwner)
            return Boolean(ctxAdminAccess(ctx) || matchesOwner(activeOwner, ctx))
    }
    const source = await uploadSource(node.source)
    if (!basename(source).startsWith(UPLOAD_TEMP_PREFIX) || ctxAdminAccess(ctx) || (await nodeStats(node))?.isDirectory())
        return true
    if ((await getUploadMeta(node.source))?.completed === true)
        return true
    if (!uploadOwners.isOpen())
        return false
    for (const key of uploadOwners.keys()) {
        const owner = uploadOwners.getSync(key)
        if (!owner || owner.unfinishedUntil === undefined || isRecordExpired(owner))
            continue
        let ownerSource = owner.unfinishedSource
        if (!ownerSource) {
            // legacy records must prove their physical source through the VFS without requester visibility filters
            const original = await urlToNode(key, undefined, undefined, { includeHidden: true })
            if (original?.source) {
                ownerSource = await uploadSource(original.source)
                await uploadOwners.put(key, { ...owner, unfinishedSource: ownerSource }).catch(console.error)
            }
        }
        if (ownerSource === source && matchesOwner(owner, ctx))
            return true
    }
    return false
}

async function uploadSource(source: string) {
    return normalizeFilename(await realpath(source).catch(() => resolve(source)))
}

export function isUnfinishedUploadOwner(node: VfsNode, ctx: Koa.Context) {
    if (node.original || !node.vfsPath || !node.source || !uploadOwners.isOpen()) return false
    const source = normalizeFilename(realpathSync.native(node.source))
    const owner = uploadOwners.getSync(cleanVfsPath(node.vfsPath))
    // a VFS remap must not carry an unfinished grant to another physical file
    if (owner && (!owner.unfinishedSource || owner.unfinishedSource === source)
        && owner.unfinishedUntil !== undefined && !isRecordExpired(owner) && matchesOwner(owner, ctx))
        return true
    return Array.from(uploadOwners.keys()).some(key => {
        const owner = uploadOwners.getSync(key)
        return owner?.unfinishedSource === source && owner.unfinishedUntil !== undefined
            && !isRecordExpired(owner) && matchesOwner(owner, ctx)
    })
}

export async function setUploadOwner(vfsPath: string, ctx: Koa.Context, expectedSource?: string, unfinishedUntil?: number | null) {
    if (!uploadOwners.isOpen() || unfinishedUntil === undefined && !ownUploadDeleteHours.get())
        return
    if (expectedSource && !await getNodeMatchingSource(vfsPath, undefined, expectedSource))
        return
    const username = getCurrentUsername(ctx) || undefined
    return uploadOwners.put(cleanVfsPath(vfsPath), {
        username,
        sessionId: username ? undefined : getSessionId(ctx),
        ip: ctx.ip,
        created: new Date(),
        unfinishedUntil,
        unfinishedSource: unfinishedUntil !== undefined && expectedSource ? await uploadSource(expectedSource) : undefined,
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
    return ctx.session!.sessionId ||= randomUUID()
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

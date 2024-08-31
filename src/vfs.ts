// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import {
    dirStream,
    getOrSet,
    isDirectory,
    makeMatcher,
    setHidden,
    onlyTruthy,
    isValidFileName,
    throw_,
    VfsPerms,
    Who,
    isWhoObject,
    WHO_ANY_ACCOUNT,
    defaultPerms,
    PERM_KEYS,
    removeStarting,
    HTTP_SERVER_ERROR,
    try_
} from './misc'
import Koa from 'koa'
import _ from 'lodash'
import { defineConfig, setConfig } from './config'
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED, IS_MAC, IS_WINDOWS, MIME_AUTO } from './const'
import events from './events'
import { expandUsername } from './perm'
import { getCurrentUsername } from './auth'
import { Stats } from 'node:fs'

type Masks = Record<string, VfsNode & { maskOnly?: 'files' | 'folders' }>

export interface VfsNodeStored extends VfsPerms {
    name?: string
    source?: string
    url?: string
    target?: string
    children?: VfsNode[]
    default?: string | false // we could have used empty string to override inherited default, but false is clearer, even reading the yaml, and works well with pickProps(), where empty strings are removed
    mime?: string | Record<string, string>
    rename?: Record<string, string>
    masks?: Masks // express fields for descendants that are not in the tree
    accept?: string
    comment?: string
    icon?: string
}
export interface VfsNode extends VfsNodeStored { // include fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
    parent?: VfsNode // available when original is available
    isFolder?: boolean
    stats?: Stats
}

export function permsFromParent(parent: VfsNode, child: VfsNode) {
    const ret: VfsPerms = {}
    for (const k of PERM_KEYS) {
        let p: VfsNode | undefined = parent
        let inheritedPerm: Who | undefined
        while (p) {
            inheritedPerm = p[k]
            // in case of object without children, parent is skipped in favor of the parent's parent
            if (!isWhoObject(inheritedPerm)) break
            inheritedPerm = inheritedPerm.children
            if (inheritedPerm !== undefined) break
            p = p.parent
        }
        if (inheritedPerm !== undefined && child[k] === undefined)  // small optimization: don't expand the object
            ret[k] = inheritedPerm
    }
    return _.isEmpty(ret) ? undefined : ret
}

function inheritFromParent(parent: VfsNode, child: VfsNode) {
    Object.assign(child, permsFromParent(parent, child))
    if (typeof parent.mime === 'object' && typeof child.mime === 'object')
        _.defaults(child.mime, parent.mime)
    else
        child.mime ??= parent.mime
    child.accept ??= parent.accept
    child.default ??= parent.default
    return child
}

export function isSameFilenameAs(name: string) {
    const normalized = normalizeFilename(name)
    return (other: string | VfsNode) =>
        normalized === normalizeFilename(typeof other === 'string' ? other : getNodeName(other))
}

function normalizeFilename(x: string) {
    return IS_WINDOWS || IS_MAC ? x.toLocaleLowerCase() : x
}

export async function applyParentToChild(child: VfsNode | undefined, parent: VfsNode, name?: string) {
    const ret: VfsNode = {
        original: child, // leave it possible for child to override this
        ...child,
        isFolder: child?.isFolder ?? (child?.children?.length! > 0 || undefined), // isFolder is hidden in original node, so we must read it to copy it
        isTemp: true,
        parent,
    }
    name ||= child ? getNodeName(child) : ''
    inheritMasks(ret, parent, name)
    await parentMaskApplier(parent)(ret, name)
    inheritFromParent(parent, ret)
    return ret
}

export async function urlToNode(url: string, ctx?: Koa.Context, parent: VfsNode=vfs, getRest?: (rest: string) => any) : Promise<VfsNode | undefined> {
    let initialSlashes = 0
    while (url[initialSlashes] === '/')
        initialSlashes++
    let nextSlash = url.indexOf('/', initialSlashes)
    const name = decodeURIComponent(url.slice(initialSlashes, nextSlash < 0 ? undefined : nextSlash))
    if (!name)
        return parent
    const rest = nextSlash < 0 ? '' : url.slice(nextSlash+1, url.endsWith('/') ? -1 : undefined)
    const ret = await getNodeByName(name, parent)
    if (!ret)
        return
    if (parent.default) // web folders have this default setting to ensure a standard behavior
        inheritFromParent({ mime: { '*': MIME_AUTO } }, ret)
    if (rest || ret?.original)
        return urlToNode(rest, ctx, ret, getRest)
    if (ret.source)
        try {
            const st = ret.stats || await fs.stat(ret.source)  // check existence
            ret.isFolder = st.isDirectory()
        }
        catch {
            if (!getRest)
                return
            const rest = ret.source.slice(parent.source!.length) // parent has source, otherwise !ret.source || ret.original
            getRest(removeStarting('/', rest))
            return parent
    }
    return ret
}

export async function getNodeByName(name: string, parent: VfsNode) {
    // does the tree node have a child that goes by this name, otherwise attempt disk
    const child = parent.children?.find(isSameFilenameAs(name)) || childFromDisk()
    return child && applyParentToChild(child, parent, name)

    function childFromDisk() {
        if (!parent.source) return
        const ret: VfsNode = {}
        let onDisk = name
        if (parent.rename) { // reverse the mapping
            for (const [from, to] of Object.entries(parent.rename))
                if (name === to) {
                    onDisk = from
                    break // found, search no more
                }
            ret.rename = renameUnderPath(parent.rename, name)
        }
        if (!isValidFileName(onDisk)) return
        ret.source = join(parent.source, onDisk)
        ret.original = undefined // overwrite in applyParentToChild, so we know this is not part of the vfs
        return ret
    }
}

export let vfs: VfsNode = {}
defineConfig<VfsNode>('vfs', {}).sub(data =>
    vfs = (function recur(node) {
        if (node.children)
            for (const c of node.children)
                recur(c)
        return node
    })(data) )

export function saveVfs() {
    return setConfig({ vfs: _.cloneDeep(vfs) }, true)
}

export function getNodeName(node: VfsNode) {
    const { name, source } = node
    if (name)
        return name
    if (!source)
        return '' // should happen only for root
    if (source === '/')
        return 'root' // better name than
    if (/^[a-zA-Z]:\\?$/.test(source))
        return source.slice(0, 2) // exclude trailing slash
    const base = basename(source)
    if (/^[./\\]*$/.test(base)) // if empty or special-chars-only
        return basename(resolve(source)) // resolve to try to get more
    if (base.includes('\\')) // source was Windows but now we are running posix. This probably happens only debugging, so it's DX
        return source.slice(source.lastIndexOf('\\') + 1)
    return base
}

export async function nodeIsDirectory(node: VfsNode) {
    if (node.isFolder !== undefined)
        return node.isFolder
    const isFolder = Boolean(node.children?.length || !nodeIsLink(node) && (node.stats?.isDirectory() ?? (!node.source || await isDirectory(node.source))))
    setHidden(node, { isFolder }) // don't make it to the storage (a node.isTemp doesn't need it to be hidden)
    return isFolder
}

export async function hasDefaultFile(node: VfsNode, ctx: Koa.Context) {
    return node.default && await nodeIsDirectory(node) && await urlToNode(node.default, ctx, node) || undefined
}

export function nodeIsLink(node: VfsNode) {
    return node.url
}

export function hasPermission(node: VfsNode, perm: keyof VfsPerms, ctx: Koa.Context): boolean {
   return !statusCodeForMissingPerm(node, perm, ctx, false)
}

export function statusCodeForMissingPerm(node: VfsNode, perm: keyof VfsPerms, ctx: Koa.Context, assign=true) {
    const ret = getCode()
    if (ret && assign) {
        ctx.status = ret
        ctx.body = ret === HTTP_UNAUTHORIZED ? "Unauthorized" : "Forbidden"
    }
    return ret

    function getCode() {
        if (!node.source && perm === 'can_upload') // Upload possible only if we know where to store. First check node.source because is supposedly faster.
            return HTTP_FORBIDDEN
        // calculate value of permission resolving references to other permissions, avoiding infinite loop
        let who: Who | undefined
        let max = PERM_KEYS.length
        let cur = perm
        do {
            who = node[cur]
            if (isWhoObject(who))
                who = who.this
            who ??= defaultPerms[cur]
            if (typeof who !== 'string' || who === WHO_ANY_ACCOUNT)
                break
            if (!max--) {
                console.error(`endless loop in permission ${perm}=${node[perm] ?? defaultPerms[perm]} for ${node.url || getNodeName(node)}`)
                return HTTP_SERVER_ERROR
            }
            cur = who
        } while (1)

        if (Array.isArray(who)) {
            const arr = who // shut up ts
            // check if I or any ancestor match `who`, but cache ancestors' usernames inside context state
            const some = getOrSet(ctx.state, 'usernames', () => expandUsername(getCurrentUsername(ctx)))
                .some((u: string) => arr.includes(u))
            return some ? 0 : HTTP_UNAUTHORIZED
        }
        return typeof who === 'boolean' ? (who ? 0 : HTTP_FORBIDDEN)
            : who === WHO_ANY_ACCOUNT ? (getCurrentUsername(ctx) ? 0 : HTTP_UNAUTHORIZED)
                : throw_(Error(`invalid permission: ${perm}=${try_(() => JSON.stringify(who))}`))
    }
}

// it's responsibility of the caller to verify you have list permission on parent, as callers have different needs.
export async function* walkNode(parent: VfsNode, {
    ctx,
    depth = Infinity,
    prefixPath = '',
    requiredPerm,
    onlyFolders = false
}: { ctx?: Koa.Context,depth?: number, prefixPath?: string, requiredPerm?: undefined | keyof VfsPerms, onlyFolders?: boolean } = {}): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    const took = prefixPath ? undefined : new Set()
    const maskApplier = parentMaskApplier(parent)
    const parentsCache = new Map() // we use this only if depth > 0
    if (children)
        for (const child of children) {
            if (onlyFolders && !await nodeIsDirectory(child)) continue
            const nodeName = getNodeName(child)
            const name = prefixPath + nodeName
            took?.add(normalizeFilename(name))
            const item = { ...child, name }
            if (!canSee(item)) continue
            if (item.source) // real items must be accessible
                try { await fs.access(item.source) }
                catch { continue }
            yield item
            if (!depth || !await nodeIsDirectory(child).catch(() => false)) continue
            parentsCache.set(name, item)
            inheritMasks(item, parent,  nodeName)
            if (!ctx || hasPermission(item, 'can_list', ctx)) // check perm before recursion
                yield* walkNode(item, { ctx, depth: depth - 1, prefixPath: name + '/', requiredPerm, onlyFolders })
        }
    if (!source)
        return
    if (requiredPerm && ctx // no permission, no reason to continue (at least for dynamic elements)
    && !hasPermission(parent, requiredPerm, ctx)
    && !masksCouldGivePermission(parent.masks, requiredPerm))
        return

    let n = 0
    try {
        let lastDir = prefixPath.slice(0, -1) || '.'
        parentsCache.set(lastDir, parent)
        for await (const entry of dirStream(source, { depth, onlyFolders, hidden: false })) {
            if (ctx?.req.aborted)
                return
            const {path} = entry
            const isFolder = entry.isDirectory()
            const name = prefixPath + (parent.rename?.[path] || path)
            if (took?.has(normalizeFilename(name))) continue
            if (depth) {
                const dir = dirname(name)
                if (dir !== lastDir)
                    parent = parentsCache.get(lastDir = dir)
            }

            const item: VfsNode = {
                name,
                isFolder,
                source: join(source, path),
                rename: renameUnderPath(parent.rename, path),
            }
            if (isFolder) // store it even if we can't see it (masks), as its children can be produced by dirStream
                parentsCache.set(name, item)
            if (canSee(item))
                yield item
            entry.closingBranch?.then(p =>
                parentsCache.delete(p || '.'))
        }
    }
    catch(e) {
        console.debug('walkNode', source, e) // ENOTDIR, or lacking permissions
    }
    parentsCache.clear() // hoping for faster GC

    // item will be changed, so be sure to pass a temp node
     function canSee(item: VfsNode) {
         // we basename for depth>0 where we already have the rest of the path in the parent's url, and would be duplicated
        maskApplier(item, basename(getNodeName(item)))
        inheritFromParent(parent, item)
        if (ctx && !hasPermission(item, 'can_see', ctx)) return
        item.isTemp = true
        return item
    }
}

export function masksCouldGivePermission(masks: Masks | undefined, perm: keyof VfsPerms): boolean {
    return masks !== undefined && Object.values(masks).some(props =>
        props[perm] || masksCouldGivePermission(props.masks, perm))
}

export function parentMaskApplier(parent: VfsNode) {
    const matchers = onlyTruthy(_.map(parent.masks, (v, k) => {
        k = k.startsWith('**/') ? k.slice(3) : !k.includes('/') ? k : '' // ** globstar matches also zero subfolders, so this mask must be applied here too
        const { maskOnly, ...mods } = v || {}
        // k is stored into the object for debugging purposes
        return k && { k, mods, matcher: makeMatcher(k), mustBeFolder: maskOnly && (maskOnly === 'folders') }
    }))
    return async (item: VfsNode, virtualBasename=getNodeName(item)) => {
        let isFolder: boolean | undefined = undefined
        for (const { matcher, mods, mustBeFolder } of matchers) {
            if (mustBeFolder !== undefined) {
                isFolder ??= await nodeIsDirectory(item)
                if (mustBeFolder !== isFolder) continue
            }
            if (!matcher(virtualBasename)) continue
            item.masks &&= _.merge(_.cloneDeep(mods.masks), item.masks) // item.masks must take precedence
            _.defaults(item, mods)
        }
    }
}

function inheritMasks(item: VfsNode, parent: VfsNode, virtualBasename:string) {
    const { masks } = parent
    if (!masks) return
    const o: Masks = {}
    for (const [k,v] of Object.entries(masks)) {
        const neg = k[0] === '!' && k[1] !== '(' ? '!' : ''
        let withoutNeg = neg ? k.slice(1) : k
        if (withoutNeg.startsWith('**')) {
            o[k] = v
            if (withoutNeg[2] === '/')
                withoutNeg = withoutNeg.slice(3) // this mask will apply also at the current level
        }
        if (withoutNeg.startsWith('*/'))
            o[neg + withoutNeg.slice(2)] = v
        else if (withoutNeg.startsWith(virtualBasename + '/'))
            o[neg + withoutNeg.slice(virtualBasename.length + 1)] = v
    }
    if (Object.keys(o).length)
        item.masks = _.defaults(item.masks, o)
}

function renameUnderPath(rename:undefined | Record<string,string>, path: string) {
    if (!rename) return rename
    const match = path+'/'
    rename = Object.fromEntries(Object.entries(rename).map(([k, v]) =>
        [k.startsWith(match) ? k.slice(match.length) : '', v]))
    delete rename['']
    return _.isEmpty(rename) ? undefined : rename
}

events.on('accountRenamed', (from, to) => {
    ;(function renameInNode(n: VfsNode) {
        for (const k of PERM_KEYS)
            renameInPerm(n[k])

        if (n.masks)
            Object.values(n.masks).forEach(renameInNode)
        n.children?.forEach(renameInNode)
    })(vfs)
    saveVfs()

    function renameInPerm(a?: Who) {
        if (!Array.isArray(a)) return
        for (let i=0; i < a.length; i++)
            if (a[i] === from)
                a[i] = to
    }

})

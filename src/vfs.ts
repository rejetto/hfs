// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import {
    CFG, makeMatcher, setHidden, onlyTruthy, isValidFileName, throw_, VfsPerms, WhoVfs, debounceAsync,
    isWhoObject, WHO_ANY_ACCOUNT, WHO_ADMIN, defaultPerms, PERM_KEYS, HTTP_SERVER_ERROR, try_, matches, Promisable,
    statWithTimeout, safeDecodeURIComponent, getUncHost, Who, enforceFinal, hasFinalSlash, pathEncode,
} from './misc'
import Koa from 'koa'
import _ from 'lodash'
import { defineConfig, saveConfigAsap } from './config'
import { HTTP_FORBIDDEN, HTTP_UNAUTHORIZED, IS_MAC, IS_WINDOWS } from './const'
import events from './events'
import { ctxBelongsTo } from './perm'
import { getCurrentUsername } from './auth'
import { Stats } from 'node:fs'
import fswin from 'fswin'
import { DESCRIPT_ION, DESCRIPT_ION_ALT, usingDescriptIon } from './comments'
import { walkDir } from './walkDir'
import { Readable } from 'node:stream'
import { ctxAdminAccess } from './adminApis'

const showHiddenFiles = defineConfig(CFG.show_hidden_files, false)

type Masks = Record<string, VfsNode>

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
    order?: number
    see_without_probing?: boolean // show this folder in its parent without waking its disk source
}
export interface VfsNode extends VfsNodeStored { // include fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
    parent?: VfsNode // available when original is available (therefore, only for isTemp)
    isFolder?: boolean // use nodeIsFolder() instead of relying on this field
    stats?: Promisable<Stats>
    vfsPath?: string // runtime-only; assign with setHidden so saveVfs doesn't persist it
}
export interface VfsNodeWithPath extends VfsNode {
    parent?: VfsNodeWithPath
    vfsPath: string
}

function setVfsPath(node: VfsNode, vfsPath: string, parent?: VfsNodeWithPath) {
    return setHidden(node, { // setHidden because we don't want to persist vfsPath
        vfsPath: enforceFinal('/', parent?.vfsPath) + pathEncode(vfsPath)
    }) as VfsNodeWithPath
}

export function permsFromParent(parent: VfsNode, child: VfsNode) {
    const ret: VfsPerms = {}
    for (const k of PERM_KEYS) {
        let p: VfsNode | undefined = parent
        let inheritedPerm: WhoVfs | undefined
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

function inheritFromParent(child: VfsNode) {
    const { parent } = child
    if (!parent) return
    Object.assign(child, permsFromParent(parent, child))
    if (typeof parent.mime === 'object' && typeof child.mime === 'object')
        _.defaults(child.mime, parent.mime)
    else
        if (parent.mime) child.mime ??= parent.mime
    if (parent.accept) child.accept ??= parent.accept
    if (parent.default) child.default ??= parent.default
    return child
}

export function isSameFilenameAs(name: string) {
    const normalized = normalizeFilename(name)
    return (other: string | VfsNode) =>
        normalized === normalizeFilename(typeof other === 'string' ? other : getNodeName(other))
}

export function normalizeFilename(x: string) {
    const cased = IS_WINDOWS || IS_MAC ? x.toLocaleLowerCase() : x
    // only macOS filesystems normalize Unicode names; elsewhere NFC and NFD may identify different files
    return IS_MAC ? cased.normalize() : cased
}

export async function isSameFilePath(a: string, b: string) {
    if (normalizeFilename(resolve(a)) === normalizeFilename(resolve(b)))
        return true
    try {
        const stats = await Promise.all([fs.lstat(a), fs.lstat(b)])
        if (stats.some(x => x.isSymbolicLink()))
            return false
        const [realA, realB] = await Promise.all([fs.realpath(a), fs.realpath(b)])
        return normalizeFilename(realA) === normalizeFilename(realB)
    }
    catch {
        return false
    }
}

// security state follows the displayed VFS identity even when I/O uses its physical alias
export function getVirtualName(name: string, parent: VfsNodeWithPath, source?: string) {
    if (source) {
        const child = getChildBySource(parent, source)
        if (child)
            return getNodeName(child)
    }
    const entries = Object.entries(parent.rename || {})
    const fromSource = source && entries.find(([from]) => isSameFilenameAs(basename(source))(from))
    if (fromSource)
        return fromSource[1]
    const sameName = isSameFilenameAs(name)
    return entries.find(([, to]) => sameName(to))?.[1]
        || entries.find(([from]) => sameName(from))?.[1]
        || name
}

export function getChildBySource(parent: VfsNode, source: string) {
    const normalizedSource = normalizeFilename(resolve(source))
    return parent.children?.find(x => x.source
        && normalizeFilename(resolve(x.source)) === normalizedSource)
}

export function getFreeVfsName(siblings: VfsNode[] | undefined, name: string) {
    const ext = extname(name)
    const noExt = ext ? name.slice(0, -ext.length) : name
    let idx = 2
    while (siblings?.find(isSameFilenameAs(name)))
        name = `${noExt} ${idx++}${ext}`
    return name
}

export function applyParentToChild(child: VfsNode | undefined, parent: VfsNodeWithPath, name?: string) {
    name ||= child ? getNodeName(child) : ''
    const ret = setVfsPath({
        original: child, // this can be overridden by passing an 'original' in `child`
        ...child,
        isFolder: child?.isFolder ?? (child?.children?.length! > 0 || undefined), // isFolder is hidden in original node, so we must copy it explicitly
        isTemp: true,
        parent,
    }, name, parent)
    inheritMasks(ret, parent, name)
    parentMaskApplier(parent)(ret, name)
    inheritFromParent(ret)
    return ret
}

export async function urlToNode(
    url: string,
    ctx?: Koa.Context,
    parent: VfsNodeWithPath=vfs.compiled(),
    options: { allowMissing?: boolean, includeHidden?: boolean }={}
) : Promise<VfsNodeWithPath | undefined> {
    let initialSlashes = 0
    while (url[initialSlashes] === '/')
        initialSlashes++
    let nextSlash = url.indexOf('/', initialSlashes)
    const slice = url.slice(initialSlashes, nextSlash < 0 ? undefined : nextSlash)
    if (!slice)
        return parent
    const name = safeDecodeURIComponent(slice, '')
    if (!name) // failed decoding
        return
    const hasTrailingSlash = url.endsWith('/')
    const rest = nextSlash < 0 ? '' : url.slice(nextSlash+1, hasTrailingSlash ? -1 : undefined)
    const assumeFolder = options.allowMissing && (rest > '' || hasTrailingSlash)
    const ret = await getNodeByName(name, parent, assumeFolder)
    if (!ret)
        return
    if (!ret.original && ret.source && !options.includeHidden && !showHiddenFiles.get() && await isHiddenFile(ret.source))
        return
    if (rest || ret?.original)
        return urlToNode(rest, ctx, ret, options)
    if (ret.source)
        if (!options.allowMissing && await setIsFolder(ret) === undefined)  // undefined = not found on disk
            return
    return ret
}

export async function nodeStats(node: VfsNode) {
    if (node.stats || !node.source)
        return node.stats
    const stats = statWithTimeout(node.source).catch(() => {
        setHidden(node, { stats: null }) // don't cache rejected promises
    })
    setHidden(node, { stats })
    return stats
}

async function isHiddenFile(path: string) {
    return IS_WINDOWS ? new Promise(res => fswin.getAttributes(path, x => res(x?.IS_HIDDEN)))
        : path[path.lastIndexOf('/') + 1] === '.'
}

export async function getNodeByName(name: string, parent: VfsNodeWithPath, assumeMissingToBeFolder=false) {
    // does the tree node have a child that goes by this name, otherwise attempt disk
    let virtualName = name
    let child = parent.children?.find(isSameFilenameAs(name))
    if (child) { // found as vfs node
        virtualName = getNodeName(child)
        await setIsFolder(child) // in case it's pointing to a folder that didn't exist at loading time
    }
    else
        child = await childFromDisk()
    return child && applyParentToChild(child, parent, virtualName)

    async function childFromDisk() {
        if (!parent.source) return
        const ret: VfsNode = {}
        let onDisk = name
        if (parent.rename) { // reverse the mapping
            const sameName = isSameFilenameAs(name)
            const entries = Object.entries(parent.rename)
            // search display names first: with { A: B, C: A }, A must resolve to C rather than be hidden
            const asDisplayName = entries.find(([, to]) => sameName(to))
            if (asDisplayName) {
                onDisk = asDisplayName[0]
                virtualName = asDisplayName[1]
            }
            else {
                const asPhysicalName = entries.find(([from]) => sameName(from))
                if (asPhysicalName) return // a VFS rename replaces the original public name
            }
            ret.rename = renameUnderPath(parent.rename, onDisk)
        }
        if (!isValidFileName(onDisk)) return
        ret.source = join(parent.source, onDisk)
        ret.original = undefined // this will overwrite the 'original' set in applyParentToChild, so we know this is not part of the vfs
        await setIsFolder(ret)
        if (assumeMissingToBeFolder)
            ret.isFolder ??= true
        return ret
    }
}

const smartUncFolderDetection = defineConfig(CFG.smart_unc_folder_detection, false)

async function setIsFolder(node: VfsNode) {
    if (!node.source) return
    const isFolder = hasFinalSlash(node.source)
        || smartUncFolderDetection.get() && getUncHost(node.source) && !basename(node.source).includes('.') // no dot = folder; not very reliable but fast for unreachable unc hosts, and it's an opt-in
        || await nodeStats(node).then(x => x?.isDirectory(), () => undefined)
    setHidden(node, { isFolder })
    if (isFolder)
        persistFolderMarker(node)
    return isFolder
}

// compiled is the stable mutable tree, while get() may return a fresh clone of the default
export const vfs = defineConfig<VfsNode, VfsNodeWithPath>(CFG.vfs, {}, x =>
    setVfsPath(structuredClone(x && typeof x === 'object' ? x : {}), '')) // ensure the type is right
vfs.sub(async () => {
    await reviewVfs()
    console.log('VFS ready')
})

async function reviewVfs() {
    await (async function recur(node: VfsNode) {
        if (node.source && !node.children?.length && node.isFolder === undefined)
            await setIsFolder(node)
        if (!node.children) return
        // we rename your node in case you got 2 nodes with the same name
        const usedNames = new Set<string>()
        for (const child of node.children) {
            const name = getNodeName(child)
            const normalized = normalizeFilename(name)
            if (usedNames.has(normalized))
                child.name = getFreeVfsName(node.children, name)
            usedNames.add(normalizeFilename(getNodeName(child)))
        }

        await Promise.allSettled(node.children.map(recur))
    })(vfs.compiled())
}

export const saveVfs = debounceAsync(async () => {
    await reviewVfs() // refresh runtime-derived folder flags before saving mutated VFS state
    vfs.set(vfs.compiled()) // sync the mutable runtime tree back to config state before persisting it
    saveConfigAsap()
})

export function isRoot(node: VfsNode) {
    return node === vfs.compiled()
}

export function getNodeName(node: VfsNode) {
    if (isRoot(node))
        return ''
    if (node.name)
        return node.name
    const { source } = node
    if (!source)
        return '' // shoulnd't happen
    if (source === '/')
        return 'root' // better name than
    if (/^[a-zA-Z]:\\?$/.test(source))
        return source.slice(0, 2) // exclude trailing slash
    const base = basename(source)
    if (/^[./\\]*$/.test(base)) // if empty or special-chars-only
        return basename(resolve(source)) // resolve to try to get more
    if (base.includes('\\') && !source.includes('/')) // source was Windows but now we are running posix. This probably happens only debugging, so it's DX
        return source.slice(source.lastIndexOf('\\') + 1)
    return base
}

// this is sync
export function nodeIsFolder(node: VfsNode) {
    return node.isFolder ?? node.original?.isFolder
        ?? (nodeIsLink(node) ? false : (node.children?.length! > 0 || !node.source || reconsider()))

    function reconsider() {
        // a networked source may be offline at startup, and become online later: recalculate in the background
        nodeStats(node).then(s => {
            if (s) {
                const isFolder = s.isDirectory()
                setHidden(node.original || node, { isFolder })
                if (isFolder)
                    persistFolderMarker(node)
            }
        }, () => {})
        return undefined
    }
}

// we mark folder paths with a final slash – the UI already does so, but the config may be modified
function persistFolderMarker(node: VfsNode) {
    if ('original' in node && !node.original) return // disk-derived nodes are temporary and must not persist VFS changes
    const stored = node.original || node // temporary VFS nodes must update their stored original for saveVfs to persist the marker
    if (!stored.source || hasFinalSlash(stored.source)) return
    stored.source += sep
    void saveVfs()
}

export async function getDefaultFile(node: VfsNodeWithPath, ctx: Koa.Context) {
    return node.default && nodeIsFolder(node) && await urlToNode(node.default, ctx, node) || undefined
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
        if ((isRoot(node) || node.original) && perm === 'can_delete' // we currently don't allow deleting of vfs nodes from frontend
        || !node.source && perm === 'can_upload') // Upload possible only if we know where to store. First check node.source because is supposedly faster.
            return HTTP_FORBIDDEN
        // calculate value of permission resolving references to other permissions, avoiding infinite loop
        let who: WhoVfs | undefined
        let max = PERM_KEYS.length
        let cur = perm
        do {
            who = node[cur]
            if (isWhoObject(who))
                who = who.this
            who ??= defaultPerms[cur]
            if (typeof who !== 'string' || who === WHO_ANY_ACCOUNT || who === WHO_ADMIN)
                break
            if (!max--) {
                console.error(`Endless loop in permission ${perm}=${node[perm] ?? defaultPerms[perm]} for ${node.url || getNodeName(node)}`)
                return HTTP_SERVER_ERROR
            }
            cur = who
        } while (1)
        if (isWhoObject(who) || isWhoVfsPerms(who))
            throw Error(`permission type-guard: ${JSON.stringify(who)}`)
        const first = _.max(events.emit('checkVfsPermission', { who, node, perm, ctx }))
        if (first !== undefined)
            return first

        return simpleWhoToError(who, ctx)
            ?? throw_(Error(`invalid permission: ${perm}=${try_(() => JSON.stringify(who))}`))
    }
}

export function simpleWhoToError(who: Who, ctx: Koa.Context) {
    if (Array.isArray(who))
        return ctxBelongsTo(ctx, who) ? 0 : HTTP_UNAUTHORIZED
    return typeof who === 'boolean' ? (who ? 0 : HTTP_FORBIDDEN)
        : who === WHO_ANY_ACCOUNT ? (getCurrentUsername(ctx) ? 0 : HTTP_UNAUTHORIZED)
            : who === WHO_ADMIN ? (ctxAdminAccess(ctx) ? 0 : HTTP_UNAUTHORIZED)
                : undefined
}

function isWhoVfsPerms(who: WhoVfs | undefined): who is keyof VfsPerms {
    return typeof who === 'string' && (PERM_KEYS as readonly string[]).includes(who)
}

interface WalkNodeOptions {
    ctx?: Koa.Context,
    depth?: number,
    prefixPath?: string,
    requiredPerm?: undefined | keyof VfsPerms,
    onlyFolders?: boolean,
    onlyFiles?: boolean,
    parallelizeRecursion?: boolean,
}
// it's the responsibility of the caller to verify you have list permission on parent, as callers have different needs.
export async function* walkNode(parent: VfsNodeWithPath, {
    ctx,
    depth = Infinity,
    prefixPath = '',
    requiredPerm,
    onlyFolders = false,
    onlyFiles = false,
    parallelizeRecursion = true,
}: WalkNodeOptions = {}) {
    let started = false
    const stream = new Readable({
        objectMode: true,
        async read() {
            if (started) return // for simplicity, we care about starting, and never suspend
            started = true
            const { source } = parent
            const taken = new Set()
            const maskApplier = parentMaskApplier(parent)
            const visitLater: [VfsNodeWithPath, string][] = []
            const childrenWorking = parent.children?.length && Promise.all(parent.children.map(async child => {
                if (ctx?.isAborted()) return
                const nodeName = getNodeName(child)
                const name = prefixPath + nodeName
                taken?.add(normalizeFilename(name))
                const item = setVfsPath({ ...child, original: child, name, parent }, name, parent)
                if (await cantSee(item)) return
                if (item.source && !item.children?.length && !item.see_without_probing) // real items must be accessible, unless probing was explicitly disabled
                    try { await fs.access(item.source) }
                    catch { return }
                const isFolder = nodeIsFolder(child)
                if (onlyFiles ? !isFolder : (!onlyFolders || isFolder))
                    stream.push(item)
                if (!depth || !isFolder || cantRecur(item)) return
                inheritMasks(item, parent)
                visitLater.push([item, name]) // prioritize siblings
            }))

            try {
                if (!source)
                    return
                if (requiredPerm && ctx // no permission, no reason to continue (at least for dynamic elements)
                    && !hasPermission(parent, requiredPerm, ctx)
                    && !masksCouldGivePermission(parent.masks, requiredPerm))
                    return

                const pathMaskApplier = parentMaskApplier(parent, true)
                try {
                    await walkDir(source, { depth, ctx, hidden: showHiddenFiles.get(), parallelizeRecursion }, async entry => {
                        if (ctx?.isAborted())
                            return null
                        if (usingDescriptIon() && (entry.name === DESCRIPT_ION || entry.name === DESCRIPT_ION_ALT))
                            return
                        const {path} = entry // this path is not the original deprecated property: we are overwriting/reusing it
                        const isFolder = entry.isDirectory()
                        let renamed = parent.rename?.[path]
                        if (renamed) {
                            const dir = dirname(path) // if `path` isn't just the name, copy its dir in renamed
                            if (dir !== '.')
                                renamed = dir + '/' + renamed
                        }
                        const name = prefixPath + (renamed || path)
                        if (taken?.has(normalizeFilename(name))) // taken by vfs node above
                            return false // false just in case it's a folder
                        const item = setVfsPath({ name, isFolder, source: join(source, path), parent, stats: entry.stats }, name, parent)
                        // masks containing '/' must be matched against the relative path while keeping walkDir recursion enabled
                        await pathMaskApplier(item, renamed || path)
                        if (await cantSee(item)) // can't see: don't produce and don't recur
                            return false
                        if (onlyFiles ? !isFolder : (!onlyFolders || isFolder))
                            stream.push(item)
                        if (cantRecur(item))
                            return false
                    })
                }
                catch(e) {
                    console.debug('walkNode', source, String(e)) // ENOTDIR, or lacking permissions
                }
            }
            finally {
                await childrenWorking
                for (const [item, name] of visitLater)
                    for await (const x of walkNode(item, { depth: depth - 1, prefixPath: name + '/', ctx, requiredPerm, onlyFolders, onlyFiles, parallelizeRecursion })) {
                        if (ctx?.isAborted())
                            return stream.push(null)
                        stream.push(x)
                    }
                stream.push(null)
            }

            function cantRecur(item: VfsNodeWithPath) {
                return ctx && !hasPermission(item, 'can_list', ctx)
            }

            // item will be changed, so be sure to pass a temp node
            async function cantSee(item: VfsNodeWithPath) {
                await maskApplier(item)
                inheritFromParent(item)
                if (ctx && !hasPermission(item, 'can_see', ctx)) return true
                item.isTemp = true
            }
        }
    })

    // must use a stream to be able to work with the callback-based mechanism of walkDir, but Readable is not typed so we wrap it with a generator
    for await (const item of stream) {
        if (ctx?.isAborted()) return
        yield item as VfsNodeWithPath
    }
}

export function masksCouldGivePermission(masks: Masks | undefined, perm: keyof VfsPerms): boolean {
    return masks !== undefined && Object.values(masks).some(props =>
        props[perm] || masksCouldGivePermission(props.masks, perm))
}

export function parentMaskApplier(parent: VfsNode, pathBased=false) {
    // rules are met in the parent.masks object from nearest to farthest, but since we finally apply with _.defaults, the nearest has precedence in the final result
    const matchers = onlyTruthy(_.map(parent.masks, (mods, mask) => {
        if (!mods) return
        const mustBeFolder = (() => { // undefined if no restriction is requested
            if (mask.at(-1) !== '|') return // parse special flag syntax as suffix |FLAG| inside the key. This allows specifying different flags with the same mask using separate keys. To avoid syntax conflicts with the rest of the file-mask, we look for an ending pipe, as it has no practical use. Ending-pipe was preferred over starting-pipe to leave the rest of the logic (inheritMasks) untouched.
            const i = mask.lastIndexOf('|', mask.length - 2)
            if (i < 0) return
            const type = mask.slice(i + 1, -1)
            mask = mask.slice(0, i) // remove
            return type === 'folders'
        })()
        if (pathBased) {
            if (!mask.includes('/')) return
            // avoid evaluating twice masks like **/*.png because parentMaskApplier already handles them by basename
            const m = /^(!?)\*\*\//.exec(mask)
            // this keeps the fast basename path as source-of-truth for patterns that collapse to a filename after **/
            if (m && !mask.slice(m[0].length).includes('/')) return
        }
        else {
            const m = /^(!?)\*\*\//.exec(mask) // ** globstar matches also zero subfolders, so this mask must be applied here too
            mask = m ? m[1] + mask.slice(m[0].length) : !mask.includes('/') ? mask : ''
            if (!mask) return
        }
        return mask && { matcher: makeMatcher(mask), mods, mustBeFolder }
    }))
    return (item: VfsNode, virtualName=(pathBased ? _.identity : basename)(getNodeName(item))!) => {
        // depth traversal passes full relative paths, while node traversal still matches only basenames
        let isFolder: boolean | undefined = undefined
        for (const { matcher, mods, mustBeFolder } of matchers) {
            if (mustBeFolder !== undefined) {
                isFolder ??= nodeIsFolder(item)
                if (mustBeFolder !== isFolder) continue
            }
            if (!matcher(virtualName)) continue
            item.masks &&= _.merge(_.cloneDeep(mods.masks), item.masks) // item.masks must take precedence
            _.defaults(item, mods)
        }
    }
}

// propagates masks, don't apply
function inheritMasks(item: VfsNode, parent: VfsNode, virtualBasename=getNodeName(item)) {
    const { masks } = parent
    if (!masks) return
    const o: Masks = {}
    for (const [k,v] of Object.entries(masks)) {
        if (k.startsWith('**')) {
            o[k] = v
            continue
        }
        const i = k.indexOf('/')
        if (i < 0) continue
        if (!matches(virtualBasename, k.slice(0, i))) continue
        o[k.slice(i + 1)] = v
    }
    if (Object.keys(o).length)
        item.masks = Object.assign(o, item.masks) // don't change item.masks object as it is the same object of item.original
}

function renameUnderPath(rename:undefined | Record<string,string>, path: string) {
    if (!rename) return rename
    const sameName = isSameFilenameAs(path)
    rename = Object.fromEntries(Object.entries(rename).map(([k, v]) => {
        const i = k.indexOf('/')
        return [i >= 0 && sameName(k.slice(0, i)) ? k.slice(i + 1) : '', v]
    }))
    delete rename['']
    return _.isEmpty(rename) ? undefined : rename
}

events.on('accountRenamed', ({ from, to }) => {
    ;(function renameInNode(n: VfsNode) {
        for (const k of PERM_KEYS)
            renameInPerm(n[k])

        if (n.masks)
            Object.values(n.masks).forEach(renameInNode)
        n.children?.forEach(renameInNode)
    })(vfs.compiled())
    saveVfs()

    function renameInPerm(a?: WhoVfs) {
        if (isWhoObject(a)) {
            renameInPerm(a.this)
            renameInPerm(a.children)
            return
        }
        if (Array.isArray(a))
            for (let i=0; i < a.length; i++)
                if (a[i] === from)
                    a[i] = to
    }

})

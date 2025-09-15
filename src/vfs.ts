// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import {
    makeMatcher, setHidden, onlyTruthy, isValidFileName, throw_, VfsPerms, Who, debounceAsync,
    isWhoObject, WHO_ANY_ACCOUNT, defaultPerms, PERM_KEYS, removeStarting, HTTP_SERVER_ERROR, try_, matches,
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
import { DESCRIPT_ION, usingDescriptIon } from './comments'
import { walkDir } from './walkDir'
import { Readable } from 'node:stream'

const showHiddenFiles = defineConfig('show_hidden_files', false)

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
}
export interface VfsNode extends VfsNodeStored { // include fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
    parent?: VfsNode // available when original is available
    isFolder?: boolean // use nodeIsFolder() instead of relying on this field
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

function normalizeFilename(x: string) {
    return (IS_WINDOWS || IS_MAC ? x.toLocaleLowerCase() : x).normalize()
}

export async function applyParentToChild(child: VfsNode | undefined, parent: VfsNode, name?: string) {
    const ret: VfsNode = {
        original: child, // this can be overridden by passing an 'original' in `child`
        ...child,
        isFolder: child?.isFolder ?? (child?.children?.length! > 0 || undefined), // isFolder is hidden in original node, so we must copy it explicitly
        isTemp: true,
        parent,
    }
    name ||= child ? getNodeName(child) : ''
    inheritMasks(ret, parent, name)
    await parentMaskApplier(parent)(ret, name)
    inheritFromParent(ret)
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
    if (rest || ret?.original)
        return urlToNode(rest, ctx, ret, getRest)
    if (ret.source)
        try {
            if (!showHiddenFiles.get() && await isHiddenFile(ret.source))
                throw 'hiddenFile'
            ret.isFolder = (await nodeStats(ret))!.isDirectory() // throws if it doesn't exist on disk
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

export async function nodeStats(ret: VfsNode) {
    if (ret.stats)
        return ret.stats
    const stats = ret.source ? await fs.stat(ret.source) : undefined
    setHidden(ret, { stats })
    return stats
}

async function isHiddenFile(path: string) {
    return IS_WINDOWS ? new Promise(res => fswin.getAttributes(path, x => res(x?.IS_HIDDEN)))
        : path[path.lastIndexOf('/') + 1] === '.'
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
        ret.original = undefined // this will overwrite the 'original' set in applyParentToChild, so we know this is not part of the vfs
        return ret
    }
}

export let vfs: VfsNode = {}
defineConfig('vfs', vfs).sub(reviewVfs)

async function reviewVfs(data=vfs) {
    await (async function recur(node) {
        if (node.source && !node.children?.length && node.isFolder === undefined) {
            const isFolder = /[\\/]$/.test(node.source) || (await nodeStats(node))?.isDirectory()
            setHidden(node, { isFolder })
        }
        if (node.children)
            await Promise.allSettled(node.children.map(recur))
    })(data)
    vfs = data
}

export const saveVfs = debounceAsync(async () => {
    await reviewVfs()
    return saveConfigAsap()
})

export function isRoot(node: VfsNode) {
    return node === vfs
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

export function nodeIsFolder(node: VfsNode) {
    return node.isFolder ?? node.original?.isFolder
        ?? (!nodeIsLink(node) && (node.children?.length! > 0 || !node.source))
}

export async function hasDefaultFile(node: VfsNode, ctx: Koa.Context) {
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
        const eventName = 'checkVfsPermission'
        if (events.anyListener(eventName)) {
            const first = _.max(events.emit(eventName, { who, node, perm, ctx }))
            if (first !== undefined)
                return first
        }

        if (Array.isArray(who))
            return ctxBelongsTo(ctx, who) ? 0 : HTTP_UNAUTHORIZED
        return typeof who === 'boolean' ? (who ? 0 : HTTP_FORBIDDEN)
            : who === WHO_ANY_ACCOUNT ? (getCurrentUsername(ctx) ? 0 : HTTP_UNAUTHORIZED)
                : throw_(Error(`invalid permission: ${perm}=${try_(() => JSON.stringify(who))}`))
    }
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
export async function* walkNode(parent: VfsNode, {
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
            const { children, source } = parent
            const taken = prefixPath ? undefined : new Set()
            const maskApplier = parentMaskApplier(parent)
            const visitLater: any = []
            if (children) for (const child of children) {
                const nodeName = getNodeName(child)
                const name = prefixPath + nodeName
                taken?.add(normalizeFilename(name))
                const item = { ...child, original: child, name, parent }
                if (await cantSee(item)) continue
                if (item.source && !item.children?.length) // real items must be accessible, unless there's more to it
                    try { await fs.access(item.source) }
                    catch { continue }
                const isFolder = nodeIsFolder(child)
                if (onlyFiles ? !isFolder : (!onlyFolders || isFolder))
                    stream.push(item)
                if (!depth || !isFolder || cantRecur(item)) continue
                inheritMasks(item, parent)
                visitLater.push([item, name]) // prioritize siblings
            }

            try {
                if (!source)
                    return
                if (requiredPerm && ctx // no permission, no reason to continue (at least for dynamic elements)
                    && !hasPermission(parent, requiredPerm, ctx)
                    && !masksCouldGivePermission(parent.masks, requiredPerm))
                    return

                try {
                    await walkDir(source, { depth, ctx, hidden: showHiddenFiles.get(), parallelizeRecursion }, async entry => {
                        if (ctx?.isAborted()) {
                            stream.push(null)
                            return null
                        }
                        if (usingDescriptIon() && entry.name === DESCRIPT_ION)
                            return
                        const {path} = entry
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

                        const item: VfsNode = { name, isFolder, source: join(source, path), parent }
                        if (await cantSee(item)) // can't see: don't produce and don't recur
                            return false
                        if (onlyFiles ? !isFolder : (!onlyFolders || isFolder))
                            stream.push(item)
                        if (cantRecur(item))
                            return false
                    })
                }
                catch(e) {
                    console.debug('walkNode', source, e) // ENOTDIR, or lacking permissions
                }
            }
            finally {
                for (const [item, name] of visitLater)
                    for await (const x of walkNode(item, { depth: depth - 1, prefixPath: name + '/', ctx, requiredPerm, onlyFolders, parallelizeRecursion }))
                        stream.push(x)
                stream.push(null)
            }

            function cantRecur(item: VfsNode) {
                return ctx && !hasPermission(item, 'can_list', ctx)
            }

            // item will be changed, so be sure to pass a temp node
            async function cantSee(item: VfsNode) {
                await maskApplier(item)
                inheritFromParent(item)
                if (ctx && !hasPermission(item, 'can_see', ctx)) return true
                item.isTemp = true
            }
        }
    })

    // must use a stream to be able to work with the callback-based mechanism of walkDir, but Readable is not typed so we wrap it with a generator
    for await (const item of stream)
        yield item as VfsNode
}

export function masksCouldGivePermission(masks: Masks | undefined, perm: keyof VfsPerms): boolean {
    return masks !== undefined && Object.values(masks).some(props =>
        props[perm] || masksCouldGivePermission(props.masks, perm))
}

export function parentMaskApplier(parent: VfsNode) {
    // rules are met in the parent.masks object from nearest to farthest, but since we finally apply with _.defaults, the nearest has precedence in the final result
    const matchers = onlyTruthy(_.map(parent.masks, (mods, k) => {
        if (!mods) return
        const mustBeFolder = (() => { // undefined if no restriction is requested
            if (k.at(-1) !== '|') return // parse special flag syntax as suffix |FLAG| inside the key. This allows specifying different flags with the same mask using separate keys. To avoid syntax conflicts with the rest of the file-mask, we look for an ending pipe, as it has no practical use. Ending-pipe was preferred over starting-pipe to leave the rest of the logic (inheritMasks) untouched.
            const i = k.lastIndexOf('|', k.length - 2)
            if (i < 0) return
            const type = k.slice(i + 1, -1)
            k = k.slice(0, i) // remove
            return type === 'folders'
        })()
        const m = /^(!?)\*\*\//.exec(k) // ** globstar matches also zero subfolders, so this mask must be applied here too
        k = m ? m[1] + k.slice(m[0].length) : !k.includes('/') ? k : ''
        return k && { mods, matcher: makeMatcher(k), mustBeFolder }
    }))
    return async (item: VfsNode, virtualBasename=basename(getNodeName(item))) => { // we basename for depth>0
        let isFolder: boolean | undefined = undefined
        for (const { matcher, mods, mustBeFolder } of matchers) {
            if (mustBeFolder !== undefined) {
                isFolder ??= nodeIsFolder(item)
                if (mustBeFolder !== isFolder) continue
            }
            if (!matcher(virtualBasename)) continue
            item.masks &&= _.merge(_.cloneDeep(mods.masks), item.masks) // item.masks must take precedence
            _.defaults(item, mods)
        }
    }
}

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
    const match = path+'/'
    rename = Object.fromEntries(Object.entries(rename).map(([k, v]) =>
        [k.startsWith(match) ? k.slice(match.length) : '', v]))
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
    })(vfs)
    saveVfs()

    function renameInPerm(a?: Who) {
        if (!Array.isArray(a)) return
        for (let i=0; i < a.length; i++)
            if (a[i] === from)
                a[i] = to
    }

})

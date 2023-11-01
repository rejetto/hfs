// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import {
    dirStream, dirTraversal, enforceFinal, getOrSet, isDirectory, typedKeys, makeMatcher, setHidden, onlyTruthy,
    typedEntries, throw_, VfsPerms, Who, isWhoObject, WHO_ANY_ACCOUNT, defaultPerms, PERM_KEYS
} from './misc'
import Koa from 'koa'
import _ from 'lodash'
import { defineConfig, setConfig } from './config'
import { HTTP_FOOL, HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from './const'
import events from './events'
import { expandUsername, getCurrentUsername } from './perm'

type Masks = Record<string, VfsNode & { maskOnly?: 'files' | 'folders' }>

export interface VfsNodeStored extends VfsPerms {
    name?: string
    source?: string
    url?: string
    children?: VfsNode[]
    default?: string | false // we could have used empty string to override inherited default, but false is clearer, even reading the yaml, and works well with pickProps(), where empty strings are removed
    mime?: string | Record<string, string>
    rename?: Record<string, string>
    masks?: Masks // express fields for descendants that are not in the tree
    accept?: string
}
export interface VfsNode extends VfsNodeStored { // include fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
    parent?: VfsNode // available when original is available
    isFolder?: boolean
}

export const MIME_AUTO = 'auto'

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
    const lc = name.toLowerCase()
    return (other: string | VfsNode) =>
        lc === (typeof other === 'string' ? other : getNodeName(other)).toLowerCase()
}

export function applyParentToChild(child: VfsNode | undefined, parent: VfsNode, name?: string) {
    const ret: VfsNode = {
        isFolder: child?.children?.length ? true : undefined, // allow child to overwrite this property
        ...child,
        original: child,
        isTemp: true,
        parent,
    }
    name ||= child ? getNodeName(child) : ''
    inheritMasks(ret, parent, name)
    parentMaskApplier(parent)(ret, name)
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
    if (dirTraversal(name) || /[\\/]/.test(name)) {
        if (ctx)
            ctx.status = HTTP_FOOL
        return
    }
    // does the tree node have a child that goes by this name?
    const child = parent.children?.find(isSameFilenameAs(name))
    if (!child && !parent.source) return // on tree or on disk, or it doesn't exist

    const ret = applyParentToChild(child, parent, name)
    if (child)
        return urlToNode(rest, ctx, ret, getRest)
    let onDisk = name
    if (parent.rename) { // reverse the mapping
        for (const [from, to] of Object.entries(parent.rename))
            if (name === to) {
                onDisk = from
                break // found, search no more
            }
        ret.rename = renameUnderPath(parent.rename, name)
    }
    ret.source = enforceFinal('/', parent.source!) + onDisk
    if (parent.default)
        inheritFromParent({ mime: { '*': MIME_AUTO } }, ret)
    if (rest)
        return urlToNode(rest, ctx, ret, getRest)
    if (ret.source)
        try {
            const st = await fs.stat(ret.source)  // check existence
            ret.isFolder = st.isDirectory()
        }
        catch {
            if (!getRest)
                return
            getRest(onDisk)
            return parent
        }
    return ret
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
        return 'root'
    if (/^[a-zA-Z]:\\?$/.test(source))
        return source.slice(0, 2) // exclude trailing slash
    const base = basename(source)
    if (/^[./\\]*$/.test(base)) // if empty or special-chars-only
        return basename(resolve(source)) // resolve to try to get more
    return base
}

export async function nodeIsDirectory(node: VfsNode) {
    if (node.isFolder !== undefined)
        return node.isFolder
    const isFolder = Boolean(node.children?.length || !nodeIsLink(node) && (!node.source || await isDirectory(node.source)))
    setHidden(node, { isFolder }) // don't make it to the storage (a node.isTemp doesn't need it to be hidden)
    return isFolder
}

export function nodeIsLink(node: VfsNode) {
    return node.url
}

export function hasPermission(node: VfsNode, perm: keyof VfsPerms, ctx: Koa.Context): boolean {
   return !statusCodeForMissingPerm(node, perm, ctx, false)
}

export function statusCodeForMissingPerm(node: VfsNode, perm: keyof VfsPerms, ctx: Koa.Context, assign=true) {
    const ret = getCode()
    if (ret && assign)
        ctx.status = ret
    return ret

    function getCode() {
        if (!node.source && perm === 'can_upload') // Upload possible only if we know where to store. First check node.source because is supposedly faster.
            return HTTP_FORBIDDEN
        // calculate value of permission resolving references to other permissions, avoiding infinite loop
        let who: Who | undefined
        let max = PERM_KEYS.length
        do {
            who = node[perm]
            if (isWhoObject(who))
                who = who.this
            who ??= defaultPerms[perm]
            if (!max-- || typeof who !== 'string' || who === WHO_ANY_ACCOUNT)
                break
            perm = who
        } while (1)

        if (Array.isArray(who)) {
            const arr = who // shut up ts
            // check if I or any ancestor match `who`, but cache ancestors' usernames inside context state
            const some = getOrSet(ctx.state, 'usernames', () => expandUsername(getCurrentUsername(ctx)))
                .some((u: string) => arr.includes(u))
            return some ? 0 : HTTP_UNAUTHORIZED
        }
        return typeof who === 'boolean' ? (who ? 0 : HTTP_FORBIDDEN)
            : who === WHO_ANY_ACCOUNT ? (ctx.state.account ? 0 : HTTP_UNAUTHORIZED)
                : throw_(Error('invalid permission: ' + JSON.stringify(who)))
    }
}

// it's responsibility of the caller to verify you have list permission on parent, as callers have different needs.
// Too many parameters: consider object, but benchmark against degraded recursion on huge folders.
export async function* walkNode(parent:VfsNode, ctx?: Koa.Context, depth:number=0, prefixPath:string='', requiredPerm?: keyof VfsPerms): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    const took = prefixPath ? undefined : new Set()
    const maskApplier = parentMaskApplier(parent)
    const parentsCache = new Map() // we use this only if depth > 0
    if (children)
        for (const child of children) {
            const nodeName = getNodeName(child)
            const name = prefixPath + nodeName
            took?.add(name)
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
                yield* walkNode(item, ctx, depth - 1, name + '/', requiredPerm)
        }
    if (!source)
        return
    if (requiredPerm && ctx // no permission, no reason to continue (at least for dynamic elements)
    && !hasPermission(parent, requiredPerm, ctx)
    && !masksCouldGivePermission(parent.masks, requiredPerm))
        return

    try {
        let lastDir = prefixPath.slice(0, -1) || '.'
        parentsCache.set(lastDir, parent)
        // it's important to keep using dirStream in deep-mode, as it is manyfold faster (it parallelizes)
        for await (const [path, isFolder] of dirStream(source, depth)) {
            if (ctx?.req.aborted)
                return
            const name = prefixPath + (parent.rename?.[path] || path)
            if (took?.has(name)) continue
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
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }

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
    const matchers = onlyTruthy(Object.entries(parent.masks || {}).map(([k, { maskOnly, ...mods }]) => {
        k = k.startsWith('**/') ? k.slice(3) : !k.includes('/') ? k : ''
        return k && { mods, maskOnly, matcher: makeMatcher(k) }
    }))
    return (item: VfsNode, virtualBasename=getNodeName(item)) => {
        for (const { matcher, mods, maskOnly } of matchers) {
            if (maskOnly === 'folders' && !item.isFolder || maskOnly === 'files' && item.isFolder) continue
            if (!matcher(virtualBasename)) continue
            if (item.masks)
                item.masks = _.merge(_.cloneDeep(mods.masks), item.masks) // item.masks must take precedence
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
        const withoutNeg = neg ? k.slice(1) : k
        if (withoutNeg.startsWith('**'))
            o[k] = v
        else if (withoutNeg.startsWith('*/'))
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

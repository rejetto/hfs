// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { matches, dirStream, dirTraversal, enforceFinal, getOrSet, isDirectory, typedKeys } from './misc'
import Koa from 'koa'
import _ from 'lodash'
import { defineConfig, setConfig } from './config'
import { HTTP_FOOL, HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from './const'
import events from './events'
import { getCurrentUsernameExpanded } from './perm'

export const WHO_ANYONE = true
export const WHO_NO_ONE = false
export const WHO_ANY_ACCOUNT = '*'
type AccountList = string[]
export type Who = typeof WHO_ANYONE
    | typeof WHO_NO_ONE
    | typeof WHO_ANY_ACCOUNT
    | AccountList // empty array shouldn't be used to keep the type boolean-able

export interface VfsPerm {
    can_read: Who
    can_see: Who
    can_list: Who
    can_upload: Who
    can_delete: Who
}

type Masks = Record<string, VfsNode>

export interface VfsNode extends Partial<VfsPerm> {
    name?: string
    source?: string
    children?: VfsNode[]
    default?: string
    mime?: string | Record<string,string>
    rename?: Record<string, string>
    masks?: Masks // express fields for descendants that are not in the tree
    accept?: string
    // fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
}

export const defaultPerms: VfsPerm = {
    can_see: WHO_ANYONE,
    can_read: WHO_ANYONE,
    can_list: WHO_ANYONE,
    can_upload: WHO_NO_ONE,
    can_delete: WHO_NO_ONE,
}

export const MIME_AUTO = 'auto'

function inheritFromParent(parent: VfsNode, child: VfsNode) {
    for (const k of typedKeys(defaultPerms))
        child[k] ??= parent[k]
    if (typeof parent.mime === 'object' && typeof child.mime === 'object')
        _.defaults(child.mime, parent.mime)
    else
        child.mime ??= parent.mime
    child.accept ??= parent.accept
    return child
}

export function isSameFilenameAs(name: string) {
    const lc = name.toLowerCase()
    return (other: string | VfsNode) =>
        lc === (typeof other === 'string' ? other : getNodeName(other)).toLowerCase()
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

    const ret: VfsNode = {
        ...child,
        original: child,
        isTemp: true,
    }
    inheritMasks(ret, parent, name)
    applyMasks(ret, parent, name)
    inheritFromParent(parent, ret)
    if (child)  // yes
        return urlToNode(rest, ctx, ret, getRest)
    // not in the tree, we can see consider continuing on the disk
    if (!parent.source) return // but then we need the current node to be linked to the disk, otherwise, we give up
    let onDisk = name
    if (parent.rename) { // reverse the mapping
        for (const [from, to] of Object.entries(parent.rename))
            if (name === to) {
                onDisk = from
                break // found, search no more
            }
        ret.rename = renameUnderPath(parent.rename, name)
    }
    ret.source = enforceFinal('/', parent.source) + onDisk
    if (parent.default)
        inheritFromParent({ mime: { '*': MIME_AUTO } }, ret)
    if (rest)
        return urlToNode(rest, ctx, ret, getRest)
    if (ret.source)
        try { await fs.stat(ret.source) } // check existence
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
    vfs = data)

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
    return Boolean(!node.source || await isDirectory(node.source))
}

export function hasPermission(node: VfsNode, perm: keyof VfsPerm, ctx: Koa.Context): boolean {
    return (node.source || perm !== 'can_upload') // Upload possible only if we know where to store. First check node.source because is supposedly faster.
        && matchWho(node[perm] ?? defaultPerms[perm], ctx)
}

export function statusCodeForMissingPerm(node: VfsNode, perm: keyof VfsPerm, ctx: Koa.Context) {
    if (hasPermission(node, perm, ctx))
        return false
    return ctx.status = node[perm] === false ? HTTP_FORBIDDEN : HTTP_UNAUTHORIZED
}

// it's responsibility of the caller to verify you have list permission on parent, as callers have different needs.
// Too many parameters: consider object, but benchmark against degraded recursion on huge folders.
export async function* walkNode(parent:VfsNode, ctx?: Koa.Context, depth:number=0, prefixPath:string='', requiredPerm?: keyof VfsPerm): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    const took = prefixPath ? undefined : new Set()
    if (children)
        for (const child of children) {
            const nodeName = getNodeName(child)
            const name = prefixPath + nodeName
            took?.add(name)
            const item = { ...child, name }
            if (!canSee(item)) continue
            yield item
            if (!depth || !await nodeIsDirectory(child).catch(() => false)) continue
            inheritMasks(item, parent,  nodeName)
            if (!ctx || hasPermission(item, 'can_list', ctx)) // check perm before recursion
                yield* walkNode(item, ctx, depth - 1, name + '/')
        }
    if (!source)
        return
    if (requiredPerm && ctx // no permission, no reason to continue (at least for dynamic elements)
    && !hasPermission(parent, requiredPerm, ctx)
    && !masksCouldGivePermission(parent.masks, requiredPerm))
        return

    try {
        let lastDir = prefixPath.slice(0, -1) || '.'
        const map = new Map()
        map.set(lastDir, parent)
        // it's important to keep using dirStream in deep-mode, as it is manyfold faster (it parallelizes)
        for await (const [path, isDir] of dirStream(source, depth)) {
            if (ctx?.req.aborted)
                return
            const name = prefixPath + (parent.rename?.[path] || path)
            if (took?.has(name)) continue
            if (depth) {
                const dir = dirname(name)
                if (dir !== lastDir)
                    parent = map.get(lastDir = dir)
            }

            const item = {
                name,
                source: join(source, path),
                rename: renameUnderPath(parent.rename, path),
            }
            if (!canSee(item)) continue
            if (isDir)
                map.set(name, item)
            yield item
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }

    // item will be changed, so be sure to pass a temp node
     function canSee(item: VfsNode) {
         // we basename for depth>0 where we already have the rest of the path in the parent's url, and would be duplicated
        applyMasks(item, parent, basename(getNodeName(item)))
        inheritFromParent(parent, item)
        if (ctx && !hasPermission(item, 'can_see', ctx)) return
        item.isTemp = true
        return item
    }

    function masksCouldGivePermission(masks: Masks | undefined) {
        if (!masks) return false
        for (const [,props] of Object.entries(masks)) {
            const v = props[requiredPerm!]
            if (v && (!ctx || matchWho(v, ctx))) // without ctx we can't say, so it could
                return true
            if (masksCouldGivePermission(props.masks))
                return true
        }
        return false
    }

}
function applyMasks(item: VfsNode, parent: VfsNode, virtualBasename: string) {
    const { masks } = parent
    if (!masks) return
    for (const [k,v] of Object.entries(masks))
        if (k.startsWith('**/') && matches(virtualBasename, k.slice(3))
        || !k.includes('/') && matches(virtualBasename, k))
            _.defaults(item, v)
}

function inheritMasks(item: VfsNode, parent: VfsNode, virtualBasename:string) {
    const { masks } = parent
    if (!masks) return
    const o: Masks = {}
    for (const [k,v] of Object.entries(masks))
        if (k.startsWith('**/'))
            o[k.slice(3)] = v
        else if (k.startsWith(virtualBasename+'/'))
            o[k.slice(virtualBasename.length+1)] = v
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

function matchWho(who: Who, ctx: Koa.Context) {
    return who === WHO_ANYONE
        || who === WHO_ANY_ACCOUNT && Boolean(ctx.state.account)
        || Array.isArray(who) // check if I or any ancestor match `who`, but cache ancestors' usernames inside context state
            && getOrSet(ctx.state, 'usernames', () => getCurrentUsernameExpanded(ctx)).some((u:string) =>
                who.includes(u) )
}

events.on('accountRenamed', (from, to) => {
    recur(vfs)
    saveVfs()

    function recur(n: VfsNode) {
        for (const k of typedKeys(defaultPerms))
            replace(n[k])

        if (n.masks)
            Object.values(n.masks).forEach(recur)
        n.children?.forEach(recur)
    }

    function replace(a?: Who) {
        if (!Array.isArray(a)) return
        for (let i=0; i < a.length; i++)
            if (a[i] === from)
                a[i] = to
    }

})

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename, join, resolve } from 'path'
import { isMatch } from 'micromatch'
import { dirStream, dirTraversal, enforceFinal, getOrSet, isDirectory, typedKeys } from './misc'
import Koa from 'koa'
import _ from 'lodash'
import { defineConfig, setConfig } from './config'
import { HTTP_FOOL, HTTP_FORBIDDEN, IS_WINDOWS, HTTP_UNAUTHORIZED } from './const'
import events from './events'
import { getCurrentUsernameExpanded } from './perm'
import { with_ } from './misc'

const WHO_ANYONE = true
const WHO_NO_ONE = false
const WHO_ANY_ACCOUNT = '*'
type AccountList = string[]
type Who = typeof WHO_ANYONE
    | typeof WHO_NO_ONE
    | typeof WHO_ANY_ACCOUNT
    | AccountList

interface VfsPerm {
    can_read: Who
    can_see: Who // use this to hide something you can_read
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
    // fields that are only filled at run-time
    isTemp?: true // this node doesn't belong to the tree and was created by necessity
    original?: VfsNode // if this is a temp node but reflecting an existing node
}

export const defaultPerms: VfsPerm = {
    can_see: WHO_ANYONE,
    can_read: WHO_ANYONE,
    can_upload: WHO_NO_ONE,
    can_delete: WHO_NO_ONE,
}

export const MIME_AUTO = 'auto'

function inheritFromParent(parent: VfsNode, child: VfsNode) {
    for (const k of typedKeys(defaultPerms)) {
        const v = parent[k]
        if (v !== undefined)
            child[k] ??= v
    }
    if (typeof parent.mime === 'object' && typeof child.mime === 'object')
        _.defaults(child.mime, parent.mime)
    else
        child.mime ||= parent.mime
    return child
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
    if (dirTraversal(name) || /[\/]/.test(name)) {
        if (ctx)
            ctx.status = HTTP_FOOL
        return
    }
    // does the tree node have a child that goes by this name?
    const sameName = !IS_WINDOWS ? (x:string) => x === name // easy
        : with_(name.toLowerCase(), lc =>
            (x: string) => x.toLowerCase() === lc)
    const child = parent.children?.find(x => sameName(getNodeName(x)))

    const ret: VfsNode = {
        ...child,
        original: child,
        isTemp: true,
    }
    inheritFromParent(parent, ret)
    inheritMasks(ret, parent, name)
    applyMasks(ret, parent, name)
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
    const { name, source: s } = node
    if (name)
        return name
    if (!s)
        return '' // should happen only for root
    if (/^[a-zA-Z]:\\?$/.test(s))
        return s.slice(0, 2) // exclude trailing slash
    const base = basename(s)
    if (/^[./\\]*$/.test(base)) // if empty or special-chars-only
        return basename(resolve(s)) // resolve to try to get more
    return base
}

export async function nodeIsDirectory(node: VfsNode) {
    return Boolean(!node.source || await isDirectory(node.source))
}

export function hasPermission(node: VfsNode, perm: keyof VfsPerm, ctx: Koa.Context): boolean {
    return matchWho(node[perm] ?? defaultPerms[perm], ctx)
        && (perm !== 'can_see' || hasPermission(node, 'can_read', ctx)) // can_see is used to hide something you nonetheless can_read, so you MUST also can_read
}

export async function* walkNode(parent:VfsNode, ctx?: Koa.Context, depth:number=0, prefixPath:string=''): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    const took = prefixPath ? undefined : new Set()
    if (children)
        for (const child of children) {
            const name = prefixPath + getNodeName(child)
            took?.add(name)
            yield* workItem({
                ...child,
                name,
            }, depth > 0 && await nodeIsDirectory(child).catch(() => false))
        }
    if (!source)
        return
    try {
        for await (const path of dirStream(source, depth)) {
            if (ctx?.req.aborted)
                return
            const name = prefixPath + (parent.rename?.[path] || path)
            if (took?.has(name)) continue
            yield* workItem({
                name,
                source: join(source, path),
                rename: renameUnderPath(parent.rename, path),
            })
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }

    // item will be changed, so be sure to pass a temp node
    async function* workItem(item: VfsNode, recur=false) {
        const name = getNodeName(item)
        // we basename for depth>0 where we already have the rest of the path in the parent's url, and would be duplicated
        const virtualBasename = basename(name)
        item.isTemp = true
        inheritFromParent(parent, item)
        applyMasks(item, parent, virtualBasename)
        if (ctx && !hasPermission(item, 'can_see', ctx))
            return
        yield item
        if (!recur) return
        inheritMasks(item, parent, virtualBasename)
        yield* walkNode(item, ctx, depth - 1, name + '/')
    }
}
function applyMasks(item: VfsNode, parent: VfsNode, virtualBasename: string) {
    const { masks } = parent
    if (!masks) return
    for (const [k,v] of Object.entries(masks))
        if (k.startsWith('**/') && isMatch(virtualBasename, k.slice(3))
        || !k.includes('/') && isMatch(virtualBasename, k))
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
        item.masks = o
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
        || Array.isArray(who) && (() => // check if I or any ancestor match `who`, but cache ancestors' usernames inside context state
            getOrSet(ctx.state, 'usernames', () => getCurrentUsernameExpanded(ctx)).some((u:string) =>
                who.includes(u) ))()
}

export function cantReadStatusCode(node: VfsNode) {
    return node.can_read === false ? HTTP_FORBIDDEN : HTTP_UNAUTHORIZED
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

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { basename } from 'path'
import { isMatch } from 'micromatch'
import { dirStream, dirTraversal, enforceFinal, getOrSet, isDirectory, typedKeys } from './misc'
import Koa from 'koa'
import glob from 'fast-glob'
import _ from 'lodash'
import { defineConfig, setConfig } from './config'
import { FORBIDDEN, IS_WINDOWS } from './const'
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
    can_see: Who
    can_read: Who
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
    url?: string // what url brought to this node
    parents?: VfsNode[]
    original?: VfsNode // if this is a temp node but reflecting an existing node
}

export const defaultPerms: VfsPerm = {
    can_see: WHO_ANYONE,
    can_read: WHO_ANYONE,
}

export const MIME_AUTO = 'auto'

function inheritFromParent(parent: VfsNode, child: VfsNode) {
    for (const k of typedKeys(defaultPerms)) {
        const v = parent[k]
        if (v !== undefined)
            child[k] = v
    }
    if (typeof parent.mime === 'object' && typeof child.mime === 'object')
        Object.assign(child.mime, parent.mime)
    else
        child.mime = parent.mime
    return child
}

export async function urlToNode(url: string, ctx?: Koa.Context, parent: VfsNode=vfs) : Promise<VfsNode | undefined> {
    let i = url.indexOf('/', 1)
    const name = decodeURIComponent(url.slice(url[0]==='/' ? 1 : 0, i < 0 ? undefined : i))
    if (!name)
        return parent
    const rest = i < 0 ? '' : url.slice(i+1, url.endsWith('/') ? -1 : undefined)
    if (dirTraversal(name) || /[\/]/.test(name)) {
        if (ctx)
            ctx.status = 418
        return
    }
    const parents = parent.parents || [] // don't waste time cloning the array, as we won't keep intermediate nodes
    const ret: VfsNode = {
        isTemp: true,
        url: enforceFinal('/', parent.url || '') + name,
        parents,
    }
    parents.push(parent)
    inheritFromParent(parent, ret)
    inheritMasks(ret, parent, name)
    applyMasks(ret, parent, name)
    // does the tree node have a child that goes by this name?
    const sameName = !IS_WINDOWS ? (x:string) => x === name // easy
        : with_(name.toLowerCase(), lc =>
            (x: string) => x.toLowerCase() === lc)
    const child = parent.children?.find(x => sameName(getNodeName(x)))
    if (child)  // yes
        return urlToNode(rest, ctx, Object.assign(ret, child, { original: child }))
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
        return urlToNode(rest, ctx, ret)
    if (ret.source)
        try { await fs.stat(ret.source) } // check existence
        catch { return }
    return ret
}

export let vfs: VfsNode = {}
defineConfig<VfsNode>('vfs', {}).sub(data =>
    vfs = data)

export function saveVfs() {
    return setConfig({ vfs: _.cloneDeep(vfs) }, true)
}

export function getNodeName(node: VfsNode) {
    return node.name
        || node.source && (
            /^[a-zA-Z]:\\?$/.test(node.source) && node.source.slice(0, 2)
            || basename(node.source)
            || node.source
        )
        || '' // should happen only for root
}

export async function nodeIsDirectory(node: VfsNode) {
    return Boolean(!node.source || await isDirectory(node.source))
}

export function hasPermission(node: VfsNode, perm: keyof VfsPerm, ctx: Koa.Context): boolean {
    return matchWho(node[perm] ?? defaultPerms[perm], ctx)
        && (perm !== 'can_see' || hasPermission(node, 'can_read', ctx)) // if you can't read, then you can't see
}

export async function* walkNode(parent:VfsNode, ctx: Koa.Context, depth:number=0, prefixPath:string=''): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    if (children)
        for (let idx = 0; idx < children.length; idx++) {
            const child = children[idx]
            yield* workItem({
                ...child,
                name: prefixPath ? (prefixPath + getNodeName(child)) : child.name
            })
        }
    if (!source)
        return
    try {
        const base = enforceFinal('/', source)
        for await (const path of dirStream(base)) {
            if (ctx.req.aborted)
                return
            let { rename } = parent
            const renamed = rename?.[path]
            yield* workItem({
                name: (prefixPath || renamed) && prefixPath + (renamed || path),
                source: base + path,
                rename: renameUnderPath(rename, path),
            })
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }

    async function* workItem(item: VfsNode) {
        // we basename for depth>0 where we already have the rest of the path in the parent's url, and would be duplicated
        const name = basename(getNodeName(item))
        const url = enforceFinal('/', parent.url || '') + name
        const temp = inheritFromParent(parent, {
            ...item,
            isTemp: true,
            url,
            parents: [ ...parent.parents||[], parent],
        })
        applyMasks(temp, parent, name)
        if (!hasPermission(temp, 'can_see', ctx))
            return
        yield temp
        try {
            if (!depth || !await nodeIsDirectory(temp)) return
            inheritMasks(temp, parent, name)
            yield* walkNode(temp, ctx, depth - 1, getNodeName(temp) + '/')
        }
        catch{} // stat failed in nodeIsDirectory, ignore
    }
}
function applyMasks(item: VfsNode, parent: VfsNode, name: string) {
    const { masks } = parent
    if (!masks) return
    for (const k in masks)
        if (k.startsWith('**/') && isMatch(name, k.slice(3))
        || !k.includes('/') && isMatch(name, k))
            Object.assign(item, masks[k])
}

function inheritMasks(item: VfsNode, parent: VfsNode, name:string) {
    const { masks } = parent
    if (!masks) return
    const o: Masks = {}
    for (const k in masks)
        if (k.startsWith('**/'))
            o[k.slice(3)] = masks[k]
        else if (k.startsWith(name+'/'))
            o[k.slice(name.length+1)] = masks[k]
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
    return node.can_read === false ? FORBIDDEN : 401
}

events.on('accountRenamed', (from, to) => {
    recur(vfs)
    saveVfs()

    function recur(n: VfsNode) {
        replace(n.can_see)
        replace(n.can_read)

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

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    applyParentToChild,
    getNodeName,
    hasPermission,
    masksCouldGivePermission,
    nodeIsDirectory,
    statusCodeForMissingPerm,
    urlToNode,
    VfsNode,
    walkNode,
    WHO_NO_ONE
} from './vfs'
import { ApiError, ApiHandler, SendListReadable } from './apiMiddleware'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { asyncGeneratorToArray, dirTraversal, pattern2filter } from './misc'
import _ from 'lodash'
import { HTTP_FOOL, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND } from './const'
import Koa from 'koa'
import { descriptIon, DESCRIPT_ION, getCommentFor } from './comments'

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date, p?: string, comment?: string }

export const get_file_list: ApiHandler = async ({ uri, offset, limit, search, c }, ctx) => {
    const node = await urlToNode(uri || '/', ctx)
    const list = ctx.get('accept') === 'text/event-stream' ? new SendListReadable() : undefined
    if (!node)
        return fail(HTTP_NOT_FOUND)
    if (statusCodeForMissingPerm(node,'can_list',ctx))
        return fail()
    if (dirTraversal(search))
        return fail(HTTP_FOOL)
    if (node.default)
        return (list?.custom ?? _.identity)({ // sse will wrap the object in a 'custom' message, otherwise we plainly return the object
            redirect: uri // tell the browser to access the folder (instead of using this api), so it will get the default file
        })
    if (!await nodeIsDirectory(node))
        return fail(HTTP_METHOD_NOT_ALLOWED)
    offset = Number(offset)
    limit = Number(limit)
    const filter = pattern2filter(search)
    const walker = walkNode(node, ctx, search ? Infinity : 0)
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    const can_upload = hasPermission(node, 'can_upload', ctx)
    const fakeChild = applyParentToChild({}, node) // we want to know if we want to delete children
    const can_delete = hasPermission(fakeChild, 'can_delete', ctx)
    const props = { can_upload, can_delete, accept: node.accept }
    if (!list)
        return { ...props, list: await asyncGeneratorToArray(produceEntries()) }
    setTimeout(async () => {
        if (can_upload || can_delete)
            list.props(props)
        for await (const entry of produceEntries())
            list.add(entry)
        list.close()
    })
    return list

    function fail(code=ctx.status) {
        if (!list)
            return new ApiError(code)
        list.error(code, true)
        return list
    }

    async function* produceEntries() {
        for await (const sub of walker) {
            if (ctx.aborted) break
            const name = getNodeName(sub)
            if (descriptIon.get() && name === DESCRIPT_ION)
                continue
            if (!filter(name))
                continue
            const entry = await nodeToDirEntry(ctx, sub)
            if (!entry)
                continue
            entry.comment = await getCommentFor(sub.source)
            const cbParams = { entry, ctx, listUri: uri, node: sub }
            try {
                const res = await Promise.all(onDirEntryHandlers.map(cb => cb(cbParams)))
                if (res.some(x => x === false))
                    continue
            }
            catch(e) {
                console.log("a plugin with onDirEntry is causing problems:", e)
            }
            if (offset) {
                --offset
                continue
            }
            if (!c) { // include c field?
                if (!entry.m)
                    entry.m = entry.c
                if (entry.c)
                    entry.c = undefined
            }
            yield entry
            if (limit && !--limit)
                break
        }
    }

    async function nodeToDirEntry(ctx: Koa.Context, node: VfsNode): Promise<DirEntry | null> {
        let { source, default:def } = node
        const name = getNodeName(node)
        if (!source)
            return name ? { n: name + '/' } : null
        if (def)
            return { n: name }
        try {
            const st = await stat(source)
            const folder = st.isDirectory()
            const { ctime, mtime } = st
            const pl = node.can_list === WHO_NO_ONE ? 'l'
                : !hasPermission(node, 'can_list', ctx) ? 'L'
                : ''
            // no download here, but maybe inside?
            const pr = node.can_read === WHO_NO_ONE && !(folder && filesInsideCould()) ? 'r'
                : !hasPermission(node, 'can_read', ctx) ? 'R'
                : ''
            const pd = !can_delete && hasPermission(node, 'can_delete', ctx) ? 'd' : ''
            return {
                n: name + (folder ? '/' : ''),
                c: ctime,
                m: Math.abs(+mtime-+ctime) < 1000 ? undefined : mtime,
                s: folder ? undefined : st.size,
                p: (pr + pl + pd) || undefined
            }
        }
        catch {
            return null
        }

        function filesInsideCould(n: VfsNode=node): boolean | undefined {
            return masksCouldGivePermission(n.masks, 'can_read')
                || n.children?.some(c => c.can_read || filesInsideCould(c)) // we count on the boolean-compliant nature of the permission type here
        }
    }
}
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { applyParentToChild, getNodeName, hasPermission, masksCouldGivePermission, nodeIsDirectory,
    statusCodeForMissingPerm, urlToNode, VfsNode, walkNode } from './vfs'
import { ApiError, ApiHandler, SendListReadable } from './apiMiddleware'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { asyncGeneratorToArray, dirTraversal, pattern2filter, WHO_NO_ONE } from './misc'
import { HTTP_FOOL, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND } from './const'
import Koa from 'koa'
import { descriptIon, DESCRIPT_ION, getCommentFor, areCommentsEnabled } from './comments'
import { basename } from 'path'
import { getConnection, updateConnection } from './connections'

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date, p?: string, comment?: string, web?: boolean, url?: string }

export const get_file_list: ApiHandler = async ({ uri, offset, limit, search, c }, ctx) => {
    const node = await urlToNode(uri || '/', ctx)
    const list = ctx.get('accept') === 'text/event-stream' ? new SendListReadable() : undefined
    if (!node)
        return fail(HTTP_NOT_FOUND)
    if (statusCodeForMissingPerm(node,'can_list',ctx))
        return fail()
    if (dirTraversal(search))
        return fail(HTTP_FOOL)
    if (await hasDefaultFile(node) || !await nodeIsDirectory(node))
        return fail(HTTP_METHOD_NOT_ALLOWED)
    offset = Number(offset)
    limit = Number(limit)
    const filter = pattern2filter(search)
    const walker = walkNode(node, ctx, search ? Infinity : 0)
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    const can_upload = hasPermission(node, 'can_upload', ctx)
    const fakeChild = applyParentToChild({}, node) // we want to know if we want to delete children
    const can_delete = hasPermission(fakeChild, 'can_delete', ctx)
    const can_archive = hasPermission(fakeChild, 'can_archive', ctx)
    const can_comment = can_upload && areCommentsEnabled()
    const props = { can_archive, can_upload, can_delete, accept: node.accept, can_comment }
    if (!list)
        return { ...props, list: await asyncGeneratorToArray(produceEntries()) }
    setTimeout(async () => {
        ctx.state.browsing = uri
        updateConnection(getConnection(ctx)!, { ctx })
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
            let name = getNodeName(sub)
            name = basename(name) || name // on windows, basename('C:') === ''
            if (descriptIon.get() && name === DESCRIPT_ION)
                continue
            if (!filter(name))
                continue
            const entry = await nodeToDirEntry(ctx, sub)
            if (!entry)
                continue
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

    async function hasDefaultFile(node: VfsNode) {
        return node.default && await urlToNode(node.default, ctx, node)
    }

    async function nodeToDirEntry(ctx: Koa.Context, node: VfsNode): Promise<DirEntry | null> {
        let { source, url } = node
        const name = getNodeName(node)
        if (url)
            return name ? { n: name, url } : null
        if (!source)
            return name ? { n: name + '/' } : null
        if (node.isFolder && await hasDefaultFile(node))
            return { n: name, web: true }
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
                p: (pr + pl + pd) || undefined,
                comment: await getCommentFor(source),
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
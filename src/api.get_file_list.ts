// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    applyParentToChild, getNodeName, hasDefaultFile, hasPermission, masksCouldGivePermission, nodeIsDirectory,
    statusCodeForMissingPerm, urlToNode, VfsNode, walkNode
} from './vfs'
import { ApiError, ApiHandler } from './apiMiddleware'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { asyncGeneratorToArray, dirTraversal, pattern2filter, WHO_NO_ONE } from './misc'
import { HTTP_FOOL, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND } from './const'
import Koa from 'koa'
import { descriptIon, DESCRIPT_ION, getCommentFor, areCommentsEnabled } from './comments'
import { basename } from 'path'
import { updateConnectionForCtx } from './connections'
import { ctxAdminAccess } from './adminApis'
import { dontOverwriteUploading } from './upload'
import { SendListReadable } from './SendList'

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date, p?: string, comment?: string, web?: boolean, url?: string, target?: string, icon?: string | true }

export const get_file_list: ApiHandler = async ({ uri='/', offset, limit, search, wild, c, onlyFolders, admin }, ctx) => {
    const node = await urlToNode(uri, ctx)
    const list = ctx.get('accept') === 'text/event-stream' ? new SendListReadable() : undefined
    if (!node)
        return fail(HTTP_NOT_FOUND)
    admin &&= ctxAdminAccess(ctx) // validate 'admin' flag
    if (dirTraversal(search))
        return fail(HTTP_FOOL)
    if (await hasDefaultFile(node, ctx) || !await nodeIsDirectory(node)) // in case of files without permission, we are provided with the frontend, and the location is the file itself
        // so, we first check if you have a permission problem, to tell frontend to show login, otherwise we fall back to method_not_allowed, as it's proper for files.
        return fail(statusCodeForMissingPerm(node, 'can_read', ctx) ? undefined : HTTP_METHOD_NOT_ALLOWED)
    if (!admin && statusCodeForMissingPerm(node, 'can_list', ctx))
        return fail()
    offset = Number(offset)
    limit = Number(limit)
    search = String(search || '').toLocaleLowerCase()
    const filter = wild === 'no' ? (s: string) => s.includes(search)
        : pattern2filter(search)
    const walker = walkNode(node, { ctx: admin ? undefined : ctx, onlyFolders, depth: search ? Infinity : 0 })
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    const can_upload = admin || hasPermission(node, 'can_upload', ctx)
    const fakeChild = await applyParentToChild({ source: 'dummy-file' }, node) // used to check permission; simple but but can produce false results
    const can_delete = admin || hasPermission(fakeChild, 'can_delete', ctx)
    const can_archive = admin || hasPermission(fakeChild, 'can_archive', ctx)
    const can_comment = can_upload && areCommentsEnabled()
    const can_overwrite = can_upload && (can_delete || !dontOverwriteUploading.get())
    const comment = node.comment ?? await getCommentFor(node.source)
    const props = { can_archive, can_upload, can_delete, can_overwrite, can_comment, comment, accept: node.accept, icon: getNodeIcon(node) }
    ctx.state.browsing = uri.replace(/\/{2,}/g, '/')
    updateConnectionForCtx(ctx)
    if (!list)
        return { ...props, list: await asyncGeneratorToArray(produceEntries()) }
    setTimeout(async () => {
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

    function getNodeIcon(node: VfsNode) {
        return node.icon?.includes('.') || node.icon // true = specific for this file, otherwise is a SYS_ICONS
    }

    async function nodeToDirEntry(ctx: Koa.Context, node: VfsNode): Promise<DirEntry | null> {
        const { source, url } = node
        const name = getNodeName(node)
        if (url)
            return name ? { n: name, url, target: node.target } : null
        const isFolder = await nodeIsDirectory(node)
        try {
            const st = source ? node.stats || await stat(source) : undefined
            const pl = node.can_list === WHO_NO_ONE ? 'l'
                : !hasPermission(node, 'can_list', ctx) ? 'L'
                : ''
            // no download here, but maybe inside?
            const pr = node.can_read === WHO_NO_ONE && !(isFolder && filesInsideCould()) ? 'r'
                : !hasPermission(node, 'can_read', ctx) ? 'R'
                : ''
            const pd = !can_delete && hasPermission(node, 'can_delete', ctx) ? 'd' : ''
            const pa = Boolean(can_archive) === hasPermission(node, 'can_archive', ctx) ? '' : can_archive ? 'a' : 'A'
            return {
                n: name + (isFolder ? '/' : ''),
                c: st?.ctime,
                m: !st || Math.abs(+st.mtime - +st.ctime) < 1000 ? undefined : st.mtime,
                s: isFolder ? undefined : st?.size,
                p: (pr + pl + pd + pa) || undefined,
                comment: node.comment ?? await getCommentFor(source),
                icon: getNodeIcon(node),
                web: await hasDefaultFile(node, ctx) ? true : undefined,
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
declare module "koa" {
    interface DefaultState {
        browsing?: string // for admin/monitoring
    }
}
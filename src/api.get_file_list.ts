// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    applyParentToChild, getNodeName, hasDefaultFile, hasPermission, masksCouldGivePermission, nodeIsDirectory,
    statusCodeForMissingPerm, urlToNode, VfsNode, walkNode
} from './vfs'
import { ApiError, ApiHandler } from './apiMiddleware'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { asyncGeneratorToArray, pattern2filter, WHO_NO_ONE } from './misc'
import { HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND } from './const'
import Koa from 'koa'
import { getCommentFor, areCommentsEnabled } from './comments'
import { basename } from 'path'
import { updateConnectionForCtx } from './connections'
import { ctxAdminAccess } from './adminApis'
import { dontOverwriteUploading } from './upload'
import { SendListReadable } from './SendList'

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date, p?: string, comment?: string, web?: boolean, url?: string, target?: string, icon?: string | true, order?: number }

export function paramsToFilter({ search, wild, searchComment, fileMask }: any) {
    search = String(search || '').toLocaleLowerCase()
    searchComment = String(searchComment || '').toLocaleLowerCase()
    return {
        depth: search || searchComment ? Infinity : 0,
        filterName: search > '' && (wild === 'no' ? (s: string) => s.includes(search) : pattern2filter(search)),
        fileMask: fileMask > '' && pattern2filter(fileMask),
        filterComment: searchComment > '' && (wild === 'no' ? (s: string) => s.includes(searchComment) : pattern2filter(searchComment))
    }
}

export const get_file_list: ApiHandler = async ({ uri='/', offset, limit, c, onlyFolders, onlyFiles, admin, ...rest }, ctx) => {
    const node = await urlToNode(uri, ctx)
    const list = ctx.get('accept') === 'text/event-stream' ? new SendListReadable() : undefined
    if (!node)
        return fail(HTTP_NOT_FOUND)
    admin &&= ctxAdminAccess(ctx) // validate 'admin' flag
    if (await hasDefaultFile(node, ctx) || !await nodeIsDirectory(node)) // in case of files without permission, we are provided with the frontend, and the location is the file itself
        // so, we first check if you have a permission problem, to tell frontend to show login, otherwise we fall back to method_not_allowed, as it's proper for files.
        return fail(!admin && statusCodeForMissingPerm(node, 'can_read', ctx) ? undefined : HTTP_METHOD_NOT_ALLOWED)
    if (!admin && statusCodeForMissingPerm(node, 'can_list', ctx))
        return fail()
    offset = Number(offset)
    limit = Number(limit)
    const { filterName, filterComment, fileMask, depth } = paramsToFilter(rest)
    const walker = walkNode(node, { ctx: admin ? undefined : ctx, onlyFolders, onlyFiles, depth })
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    const can_upload = admin || hasPermission(node, 'can_upload', ctx)
    const can_delete = admin || hasPermission(node, 'can_delete', ctx)
    const fakeChild = await applyParentToChild({ source: 'dummy-file', original: undefined }, node) // used to check permission; simple but can produce false results; 'original' to simulate a non-vfs node
    const can_delete_children = admin || hasPermission(fakeChild, 'can_delete', ctx)
    const can_archive = admin || hasPermission(node, 'can_archive', ctx)
    const can_comment = can_upload && areCommentsEnabled()
    const can_overwrite = can_upload && (can_delete || !dontOverwriteUploading.get())
    const comment = node.comment ?? await getCommentFor(node.source)
    const props = { can_archive, can_upload, can_delete, can_delete_children, can_overwrite, can_comment, comment, accept: node.accept, icon: getNodeIcon(node) }
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
            let name = getNodeName(sub)
            name = basename(name) || name // on windows, basename('C:') === ''
            if (filterName && !filterName(name) || fileMask && !await nodeIsDirectory(sub) && !fileMask(name)
            || filterComment && !filterComment(await getCommentFor(sub.source) || ''))
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
            if (c === 'no' && entry.c) // allow excluding c for smaller payload
                entry.c = undefined
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
            const st = source ? node.stats || await stat(source).catch(e => {
                if (!isFolder || !node.children?.length) // folders with virtual children, keep them
                    throw e
            }) : undefined
            // permissions of entries are sent as a difference with permissions of parent
            const pl = node.can_list === WHO_NO_ONE ? 'l'
                : !hasPermission(node, 'can_list', ctx) ? 'L'
                : ''
            // no download here, but maybe inside?
            const pr = node.can_read === WHO_NO_ONE && !(isFolder && filesInsideCould()) ? 'r'
                : !hasPermission(node, 'can_read', ctx) ? 'R'
                : ''
            // for delete, the diff is based on can_delete_children instead of can_delete, because it will produce fewer data
            const pd = Boolean(can_delete_children) === hasPermission(node, 'can_delete', ctx) ? '' : can_delete_children ? 'd' : 'D'
            const pa = Boolean(can_archive) === hasPermission(node, 'can_archive', ctx) ? '' : can_archive ? 'a' : 'A'
            const pu = !isFolder || Boolean(can_upload) === hasPermission(node, 'can_upload', ctx) ? '' : can_upload ? 'u' : 'U'
            return {
                n: name + (isFolder ? '/' : ''),
                c: st?.birthtime,
                m: !st || Math.abs(st.mtimeMs - st.birthtimeMs) < 1000 ? undefined : st.mtime,
                s: isFolder ? undefined : st?.size,
                p: (pr + pl + pd + pa + pu) || undefined,
                order: node.order,
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
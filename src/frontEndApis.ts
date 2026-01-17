// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { get_file_list } from './api.get_file_list'
import * as api_auth from './api.auth'
import events from './events'
import Koa from 'koa'
import { hasDirTraversal, isValidFileName } from './util-files'
import {
    HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FAILED_DEPENDENCY, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED,
    HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED
} from './const'
import {
    hasPermission, isRoot, nodeIsFolder, nodeStats, statusCodeForMissingPerm, urlToNode, VfsNode, walkNode
} from './vfs'
import fs from 'fs'
import { mkdir, rename, copyFile, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getUploadMeta } from './upload'
import { apiAssertTypes, popKey } from './misc'
import { getCommentFor, setCommentFor } from './comments'
import { SendListReadable } from './SendList'
import { ctxAdminAccess } from './adminApis'
import _ from 'lodash'

const partialFolderSize: any = {}

export const frontEndApis: ApiHandlers = {
    get_file_list,
    ...api_auth,

    get_notifications({ channel }, ctx) {
        apiAssertTypes({ string: { channel } })
        const list = new SendListReadable()
        list.ready() // on chrome109 EventSource doesn't emit 'open' until something is sent
        return list.events(ctx, {
            [NOTIFICATION_PREFIX + channel](name, data) {
                list.custom(name, data)
            }
        })
    },

    async get_file_details({ uris }, ctx) {
        if (typeof uris?.[0] !== 'string')
            return new ApiError(HTTP_BAD_REQUEST, 'bad uris')
        const isAdmin = ctxAdminAccess(ctx)
        return {
            details: await Promise.all(uris.map(async (uri: any) => {
                if (typeof uri !== 'string')
                    return false // false means error
                const node = await urlToNode(uri, ctx)
                if (!node || !hasPermission(node, 'can_see', ctx))
                    return false
                let upload = node.source && await getUploadMeta(node.source).catch(() => undefined)
                if (!upload) return false
                if (!isAdmin)
                    upload = _.omit(upload, 'ip')
                return { upload }
            }))
        }
    },

    async create_folder({ uri, name }, ctx) {
        apiAssertTypes({ string: { uri, name } })
        ctx.logExtra(null, { name, target: decodeURI(uri) })
        if (!isValidFileName(name))
            return new ApiError(HTTP_BAD_REQUEST, 'bad name')
        const parentNode = await urlToNode(uri, ctx)
        if (!parentNode)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        const err = statusCodeForMissingPerm(parentNode, 'can_upload', ctx)
        if (err)
            return new ApiError(err)
        try {
            await mkdir(join(parentNode.source!, name))
            return {}
        }
        catch(e:any) {
            return new ApiError(e.code === 'EEXIST' ? HTTP_CONFLICT : HTTP_BAD_REQUEST, e)
        }
    },

    async rename({ uri, dest }, ctx) {
        apiAssertTypes({ string: { uri, dest } })
        ctx.logExtra(null, { target: decodeURI(uri), destination: decodeURI(dest) })
        const node = await urlToNode(uri, ctx)
        if (!node)
            throw new ApiError(HTTP_NOT_FOUND)
        if (isRoot(node) || dest.includes('/') || hasDirTraversal(dest))
            throw new ApiError(HTTP_FORBIDDEN)
        if (statusCodeForMissingPerm(node, 'can_delete', ctx))
            throw new ApiError(ctx.status)
        try {
            if (!node.source)
                throw new ApiError(HTTP_FAILED_DEPENDENCY)
            const destSource = join(dirname(node.source), dest)
            await rename(node.source, destSource)
            getCommentFor(node.source).then(c => {
                if (!c) return
                void setCommentFor(node.source!, '')
                void setCommentFor(destSource, c)
            })
            return {}
        }
        catch (e: any) {
            throw new ApiError(HTTP_SERVER_ERROR, e)
        }
    },

    async move_files({ uri_from, uri_to }, ctx, override) {
        apiAssertTypes({ array: { uri_from }, string: { uri_to } })
        ctx.logExtra(null, { target: uri_from.map(decodeURI), destination: decodeURI(uri_to) })
        const destNode = await urlToNode(uri_to, ctx)
        const err = !destNode ? HTTP_NOT_FOUND : statusCodeForMissingPerm(destNode, 'can_upload', ctx)
        if (err)
            return new ApiError(err)
        return {
            errors: await Promise.all(uri_from.map(async (from1: any) => {
                if (typeof from1 !== 'string') return HTTP_BAD_REQUEST
                const srcNode = await urlToNode(from1, ctx)
                const src = srcNode?.source
                if (!src) return HTTP_NOT_FOUND
                const dest = join(destNode!.source!, basename(src))
                if (_.isFunction(override))
                    return override?.(srcNode, dest)
                return statusCodeForMissingPerm(srcNode, 'can_delete', ctx)
                    || rename(src, dest).catch(async e => {
                        if (e.code !== 'EXDEV') throw e // exdev = different drive
                        await copyFile(src, dest)
                        await unlink(src)
                    }).catch(e => e.code || String(e))
            }))
        }
    },

    async copy_files(params, ctx) {
        return frontEndApis.move_files!(params, ctx, // same parameters
            (srcNode: VfsNode, dest: string) => // but override behavior
                statusCodeForMissingPerm(srcNode, 'can_read', ctx)
                    // .source is checked by move_files
                    || copyFile(srcNode.source!, dest, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE)
                        .catch(e => e.code || String(e))
        )
    },

    async comment({ uri, comment }, ctx) {
        apiAssertTypes({ string: { uri, comment } })
        ctx.logExtra(null, { target: decodeURI(uri) })
        const node = await urlToNode(uri, ctx)
        if (!node)
            throw new ApiError(HTTP_NOT_FOUND)
        if (!hasPermission(node, 'can_upload', ctx))
            throw new ApiError(HTTP_UNAUTHORIZED)
        if (!node.source)
            throw new ApiError(HTTP_FAILED_DEPENDENCY)
        await setCommentFor(node.source, comment)
        return {}
    },

    async get_folder_size_partial({ id }, ctx) {
        apiAssertTypes({ string: { id } })
        return partialFolderSize[id] || new ApiError(HTTP_NOT_FOUND)
    },

    async get_folder_size({ uri, id }, ctx) {
        apiAssertTypes({ string: { uri } })
        const folder = await urlToNode(uri, ctx)
        if (!folder)
            throw new ApiError(HTTP_NOT_FOUND)
        if (!nodeIsFolder(folder))
            throw new ApiError(HTTP_METHOD_NOT_ALLOWED)
        if (statusCodeForMissingPerm(folder, 'can_list', ctx))
            return new ApiError(ctx.status)
        let bytes = 0
        let files = 0
        for await (const n of walkNode(folder, { ctx, onlyFiles: true, depth: Infinity })) {
            bytes += await nodeStats(n).then(x => x?.size || 0, () => 0)
            files++
            partialFolderSize[id] = { bytes, files }
        }
        return popKey(partialFolderSize, id) || { bytes, files }
    },
}

export function notifyClient(channel: string | Koa.Context, name: string, data: any) {
    if (typeof channel !== 'string')
        channel = String(channel.query.notifications)
    events.emit(NOTIFICATION_PREFIX + channel, name, data)
}

const NOTIFICATION_PREFIX = 'notificationChannel:'

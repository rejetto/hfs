// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { get_file_list } from './api.get_file_list'
import * as api_auth from './api.auth'
import events from './events'
import Koa from 'koa'
import { dirTraversal, isValidFileName } from './util-files'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FAILED_DEPENDENCY, HTTP_FORBIDDEN,
    HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED } from './const'
import { hasPermission, statusCodeForMissingPerm, urlToNode } from './vfs'
import { mkdir, rename, copyFile, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { getUploadMeta } from './upload'
import { apiAssertTypes, deleteNode } from './misc'
import { getCommentFor, setCommentFor } from './comments'
import { SendListReadable } from './SendList'

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
        return {
            details: await Promise.all(uris.map(async (uri: any) => {
                if (typeof uri !== 'string')
                    return false // false means error
                const node = await urlToNode(uri, ctx)
                if (!node)
                    return false
                const upload = node.source && await getUploadMeta(node.source).catch(() => undefined)
                return upload && { upload }
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

    async delete({ uri }, ctx) {
        apiAssertTypes({ string: { uri } })
        const node = await urlToNode(uri, ctx)
        if (!node)
            throw new ApiError(HTTP_NOT_FOUND)
        const res = await deleteNode(ctx, node, uri)
        if (typeof res === 'number')
            throw new ApiError(res)
        if (res instanceof Error)
            throw new ApiError(HTTP_SERVER_ERROR, res)
        return res && {}
    },

    async rename({ uri, dest }, ctx) {
        apiAssertTypes({ string: { uri, dest } })
        ctx.logExtra(null, { target: decodeURI(uri), destination: decodeURI(dest) })
        if (dest.includes('/') || dirTraversal(dest))
            throw new ApiError(HTTP_FORBIDDEN)
        const node = await urlToNode(uri, ctx)
        if (!node)
            throw new ApiError(HTTP_NOT_FOUND)
        if (!hasPermission(node, 'can_delete', ctx))
            throw new ApiError(HTTP_UNAUTHORIZED)
        try {
            if (node.name) // virtual name = virtual rename
                node.name = dest
            else {
                if (!node.source)
                    throw new ApiError(HTTP_FAILED_DEPENDENCY)
                const destSource = join(dirname(node.source), dest)
                await rename(node.source, destSource)
                getCommentFor(node.source).then(c => {
                    if (!c) return
                    void setCommentFor(node.source!, '')
                    void setCommentFor(destSource, c)
                })
            }
            return {}
        }
        catch (e: any) {
            throw new ApiError(HTTP_SERVER_ERROR, e)
        }
    },

    async move_files({ uri_from, uri_to }, ctx) {
        apiAssertTypes({ array: { uri_from }, string: { uri_to } })
        ctx.logExtra(null, { target: uri_from.map(decodeURI), destination: decodeURI(uri_to) })
        const destNode = await urlToNode(uri_to, ctx)
        const code = !destNode ? HTTP_NOT_FOUND : statusCodeForMissingPerm(destNode, 'can_upload', ctx)
        if (code) return new ApiError(code)
        return {
            errors: await Promise.all(uri_from.map(async (src: any) => {
                if (typeof src !== 'string') return HTTP_BAD_REQUEST
                const srcNode = await urlToNode(src, ctx)
                if (!srcNode) return HTTP_NOT_FOUND
                const s = srcNode.source!
                const d = join(destNode!.source!, basename(srcNode.source!))
                return statusCodeForMissingPerm(srcNode, 'can_delete', ctx)
                    || rename(s, d).catch(async e => {
                        if (e.code !== 'EXDEV') throw e // exdev = different drive
                        await copyFile(s, d)
                        await unlink(s)
                    }).catch(e => e.code || String(e))
            }))
        }
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
}

export function notifyClient(channel: string | Koa.Context, name: string, data: any) {
    if (typeof channel !== 'string')
        channel = String(channel.query.notificationChannel)
    events.emit(NOTIFICATION_PREFIX + channel, name, data)
}

const NOTIFICATION_PREFIX = 'notificationChannel:'

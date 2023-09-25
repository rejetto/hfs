// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { get_file_list } from './api.file_list'
import * as api_auth from './api.auth'
import events from './events'
import Koa from 'koa'
import { dirTraversal, isValidFileName } from './util-files'
import {
    HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FAILED_DEPENDENCY, HTTP_FORBIDDEN,
    HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED
} from './const'
import { hasPermission, urlToNode } from './vfs'
import { mkdir, rename, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { getUploadMeta } from './upload'
import { apiAssertTypes } from './misc'
import { setCommentFor } from './comments'

export const frontEndApis: ApiHandlers = {
    get_file_list,
    ...api_auth,

    get_notifications({ channel }, ctx) {
        apiAssertTypes({ string: { channel } })
        const list = new SendListReadable()
        list.ready() // on chrome109 EventSource doesn't emit 'open' until something is sent
        return list.events(ctx, {
            [NOTIFICATION_PREFIX + channel](name, data) {
                list.custom({ name, data })
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
        if (!isValidFileName(name) || dirTraversal(name))
            return new ApiError(HTTP_BAD_REQUEST, 'bad name')
        const parentNode = await urlToNode(uri, ctx)
        if (!parentNode)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        if (!hasPermission(parentNode, 'can_upload', ctx))
            return new ApiError(HTTP_FORBIDDEN)
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
        if (!node.source)
            throw new ApiError(HTTP_FORBIDDEN)
        if (!hasPermission(node, 'can_delete', ctx))
            throw new ApiError(HTTP_UNAUTHORIZED)
        try {
            await rm(node.source, { recursive: true })
            return {}
        }
        catch (e: any) {
            throw new ApiError(HTTP_SERVER_ERROR, e)
        }
    },

    async rename({ uri, dest }, ctx) {
        apiAssertTypes({ string: { uri, dest } })
        if (dest.includes('/') || dirTraversal(dest))
            throw new ApiError(HTTP_FORBIDDEN)
        const node = await urlToNode(uri, ctx)
        if (!node)
            throw new ApiError(HTTP_NOT_FOUND)
        if (!hasPermission(node, 'can_delete', ctx))
            throw new ApiError(HTTP_UNAUTHORIZED)
        try {
            if (node.name)
                node.name = dest
            else if (node.source)
                await rename(node.source, join(dirname(node.source), dest))
            else
                throw new ApiError(HTTP_SERVER_ERROR)
            return {}
        }
        catch (e: any) {
            throw new ApiError(HTTP_SERVER_ERROR, e)
        }
    },

    async comment({ uri, comment }, ctx) {
        apiAssertTypes({ string: { uri, comment } })
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

export function notifyClient(ctx: Koa.Context, name: string, data: any) {
    const {notificationChannel} = ctx.query
    if (notificationChannel)
        events.emit(NOTIFICATION_PREFIX + notificationChannel, name, data)
}

const NOTIFICATION_PREFIX = 'notificationChannel:'

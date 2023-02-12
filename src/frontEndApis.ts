// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { file_list } from './api.file_list'
import * as api_auth from './api.auth'
import { defineConfig } from './config'
import events from './events'
import Koa from 'koa'
import { dirTraversal, isValidFileName } from './util-files'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FORBIDDEN, HTTP_NOT_FOUND } from './const'
import { hasPermission, urlToNode } from './vfs'
import { mkdir } from 'fs/promises'
import { join } from 'path'

const customHeader = defineConfig('custom_header')

export const frontEndApis: ApiHandlers = {
    file_list,
    ...api_auth,

    config() {
        return Object.fromEntries([customHeader].map(x => [x.key(), x.get()]))
    },

    get_notifications({ channel }, ctx) {
        const list = new SendListReadable()
        list.ready() // on chrome109 EventSource doesn't emit 'open' until something is sent
        return list.events(ctx, {
            [NOTIFICATION_PREFIX + channel](name, data) {
                list.custom({ name, data })
            }
        })
    },

    async create_folder({ path, name }, ctx) {
        if (!isValidFileName(name) || dirTraversal(name))
            return new ApiError(HTTP_BAD_REQUEST, 'bad name')
        const parentNode = await urlToNode(path)
        if (!parentNode)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        const { source } = parentNode
        if (!source || !hasPermission(parentNode, 'can_upload', ctx))
            return new ApiError(HTTP_FORBIDDEN)
        try {
            await mkdir(join(source, name))
            return {}
        }
        catch(e:any) {
            return new ApiError(e.code === 'EEXIST' ? HTTP_CONFLICT : HTTP_BAD_REQUEST, e)
        }
    },

}

export function notifyClient(ctx: Koa.Context, name: string, data: any) {
    const {notificationChannel} = ctx.query
    if (notificationChannel)
        events.emit(NOTIFICATION_PREFIX + notificationChannel, name, data)
}

const NOTIFICATION_PREFIX = 'notificationChannel:'
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import { file_list } from './api.file_list'
import * as api_auth from './api.auth'
import { defineConfig } from './config'
import events from './events'
import Koa from 'koa'
import { dirTraversal, isValidFileName } from './util-files'
import {
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_FORBIDDEN,
    HTTP_NOT_FOUND,
    HTTP_SERVER_ERROR,
    HTTP_UNAUTHORIZED
} from './const'
import { hasPermission, urlToNode } from './vfs'
import { mkdir, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { wantArray } from './misc'

export const customHeader = defineConfig<string | undefined>('custom_header')

export const frontEndApis: ApiHandlers = {
    file_list,
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

    async create_folder({ path, name }, ctx) {
        apiAssertTypes({ string: { path, name } })
        if (!isValidFileName(name) || dirTraversal(name))
            return new ApiError(HTTP_BAD_REQUEST, 'bad name')
        const parentNode = await urlToNode(path, ctx)
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

    async del({ path }, ctx) {
        apiAssertTypes({ string: { path } })
        const node = await urlToNode(path, ctx)
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
            throw new ApiError(e.code || HTTP_SERVER_ERROR, e)
        }
    },

    async load_lang({ lang }) {
        const ret: any = {}
        const langs = wantArray(lang)
        const tried: string[] = []
        for (let k of langs) {
            k = k.toLowerCase()
            while (1) {
                if (tried.includes(k)) break
                tried.push(k)
                try { ret[k] = JSON.parse(await readFile(`hfs-lang-${k}.json`, 'utf8')) }
                catch {}
                const i = k.lastIndexOf('-')
                if (ret[k] || i < 0) break
                k = k.slice(0, i)
            }
        }
        return ret
    }

}

export function notifyClient(ctx: Koa.Context, name: string, data: any) {
    const {notificationChannel} = ctx.query
    if (notificationChannel)
        events.emit(NOTIFICATION_PREFIX + notificationChannel, name, data)
}

const NOTIFICATION_PREFIX = 'notificationChannel:'

function apiAssertTypes(paramsByType: { [type:string]: { [name:string]: any  } }) {
    for (const [type,params] of Object.entries(paramsByType))
        for (const [name,val] of Object.entries(params))
            if (typeof val !== type)
                throw new ApiError(HTTP_BAD_REQUEST, 'bad ' + name)
}
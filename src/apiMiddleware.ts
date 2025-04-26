// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, CFG, Promisable } from './misc'
import { HTTP_BAD_REQUEST, HTTP_FOOL, PLUGIN_CUSTOM_REST_PREFIX } from './const'
import { defineConfig } from './config'
import { firstPlugin } from './plugins'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error | object) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any> | null
// allow defining extra parameters that can be used when an api to invoke another (like copy_files)
export type ApiHandler = (params:any, ctx:Koa.Context, ...ignore: unknown[]) => Promisable<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

const logApi = defineConfig(CFG.log_api, true)

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        if (!logApi.get())
            ctx.state.dontLog = true
        const isPost = ctx.state.params
        const params = isPost ? ctx.state.params || {} : ctx.query
        const apiName = ctx.path
        console.debug('API', ctx.method, apiName, { ...params })
        const noBrowser = ctx.get('user-agent')?.startsWith('curl')
        const safe = noBrowser || isPost && ctx.get('x-hfs-anti-csrf') // POST is safe because browser will enforce SameSite cookie
            || apiName.startsWith('get_') // "get_" apis are safe because they make no change
        if (!safe)
            return send(HTTP_FOOL, "missing header x-hfs-anti-csrf=1")
        const customApiRest = apiName.startsWith(PLUGIN_CUSTOM_REST_PREFIX) && apiName.slice(PLUGIN_CUSTOM_REST_PREFIX.length)
        const apiFun = customApiRest && firstPlugin(pl => pl.getData().customRest?.[customApiRest])
            || apis.hasOwnProperty(apiName) && apis[apiName]!
        if (!apiFun)
            return send(HTTP_BAD_REQUEST, 'invalid api')
        // we don't rely on SameSite cookie option because it's https-only
        let res
        try {
            res = await apiFun(params, ctx)
            if (res === null) return
        }
        catch(e) {
            if (typeof e === 'string') // message meant to be transmitted
                return send(HTTP_BAD_REQUEST, e)
            if (typeof e === 'number')
                e = new ApiError(e)
            res = e
        }
        if (isAsyncGenerator(res))
            res = asyncGeneratorToReadable(res)
        if (res instanceof Readable) { // Readable, we'll go SSE-mode
            res.pipe(createSSE(ctx))
            const resAsReadable = res // satisfy ts
            ctx.req.on('close', () => // by closing the generated stream, creator of the stream will know the request is over without having to access anything else
                resAsReadable.destroy())
            return
        }
        if (res instanceof ApiError)
            return send(res.status, res.message)
        if (res instanceof Error)  // generic error/exception
            return send(HTTP_BAD_REQUEST, res.stack || res.message || String(res))
        ctx.body = res

        function send(status: number, body?: string) {
            ctx.body = body
            ctx.status = status
        }
    }
}

function isAsyncGenerator(x: any): x is AsyncGenerator {
    return typeof (x as AsyncGenerator)?.next === 'function'
}

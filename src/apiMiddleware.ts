// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, CFG, removeStarting } from './misc'
import { HTTP_BAD_REQUEST, HTTP_FOOL, HTTP_NOT_FOUND } from './const'
import { defineConfig } from './config'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error | object) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any>
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
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
        const safe = isPost && ctx.get('x-hfs-anti-csrf') // POST is safe because browser will enforce SameSite cookie
            || apiName.startsWith('get_') // "get_" apis are safe because they make no change
        if (!safe)
            return send(HTTP_FOOL)
        const apiFun = apis.hasOwnProperty(apiName) && apis[apiName]!
        if (!apiFun)
            return send(HTTP_NOT_FOUND, 'invalid api')
        // we don't rely on SameSite cookie option because it's https-only
        let res
        try {
            if (ctx.state.revProxyPath)
                for (const [k,v] of Object.entries(params))
                    if (k.startsWith('uri'))
                        if (typeof v === 'string')
                            fixUri(params, k)
                        else if (typeof (v as any)?.[0] === 'string')
                            (v as string[]).forEach((x,i) => fixUri(v,i))
            res = await apiFun(params, ctx)

            function fixUri(obj: any, k: string | number) {
                obj[k] = removeStarting(ctx.state.revProxyPath, obj[k])
            }
        }
        catch(e) {
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

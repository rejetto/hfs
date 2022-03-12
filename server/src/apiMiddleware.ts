// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { IncomingMessage } from 'http'
import Koa from 'koa'
import createSSE from './sse'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error) {
        super(typeof message === 'string' ? message : message?.message)
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | AsyncGenerator<any>
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        const params = ctx.method === 'POST' ? await getJsonFromReq(ctx.req) : ctx.request.query
        console.debug('API', ctx.method, ctx.path, { ...params })
        if (!apis.hasOwnProperty(ctx.path)) {
            ctx.body = 'invalid api'
            return ctx.status = 404
        }
        const csrf = ctx.cookies.get('csrf')
        // we don't rely on SameSite cookie option because it's https-only
        const res = csrf && csrf !== params.csrf ? new ApiError(401, 'csrf')
            : await apis[ctx.path](params || {}, ctx)
        // if it returns an AsyncIterator we'll go SSE-mode
        if (isAsyncGenerator(res)) {
            const sse = createSSE(ctx) // initiate SSE and return, then we'll continue sending values asynchronously
            setTimeout(async ()=> {
                const iterable = { [Symbol.asyncIterator]: () => res }
                for await (const value of iterable)
                    sse.send(value)
                sse.close()
            })
            return
        }
        if (res instanceof ApiError) {
            ctx.body = res.message
            return ctx.status = res.status
        }
        if (res instanceof Error) {
            ctx.body = String(res)
            return ctx.status = 400
        }
        ctx.body = res
    }
}

function isAsyncGenerator(x: any): x is AsyncGenerator {
    return typeof (x as AsyncGenerator)?.next === 'function'
}

async function getJsonFromReq(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk =>
            data += chunk)
        req.on('error', reject)
        req.on('end', () => {
            try {
                resolve(data && JSON.parse(data))
            }
            catch(e) {
                reject(e)
            }
        })
    })
}

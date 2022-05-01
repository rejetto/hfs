// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { IncomingMessage } from 'http'
import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, onOff } from './misc'
import events from './events'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error) {
        super(typeof message === 'string' ? message : message?.message)
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any>
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
        let res = csrf && csrf !== params.csrf ? new ApiError(401, 'csrf')
            : await apis[ctx.path](params || {}, ctx)
        if (isAsyncGenerator(res))
            res = asyncGeneratorToReadable(res)
        if (res instanceof Readable) // Readable, we'll go SSE-mode
            return res.pipe(createSSE(ctx))
        if (res instanceof ApiError) {
            ctx.body = res.message
            return ctx.status = res.status
        }
        if (res instanceof Error) { // generic exception
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

// offer an api for a generic dynamic list
export function sendList<T>(addAtStart: T[]=[]) {
    const stream = new Readable({ objectMode: true, read(){} })
    const ret = {
        return: stream,
        add(rec: T) { stream.push({ add: rec }) },
        remove(key: Partial<T>) { stream.push({ remove: [ key ] }) },
        update(search: Partial<T>, change: Partial<T>) {
            stream.push({ update:[{ search, change }] })
        },
        events(ctx: Koa.Context, eventMap: Parameters<typeof onOff>[1]) {
            const off = onOff(events, eventMap)
            ctx.res.once('close', off)
            return stream
        }
    }
    for (const x of addAtStart)
        ret.add(x)
    stream.push('init')
    return ret
}


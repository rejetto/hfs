// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { IncomingMessage } from 'http'
import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, objSameKeys, onOff, tryJson } from './misc'
import events from './events'
import { UNAUTHORIZED } from './const'

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
        const params = ctx.method === 'POST' ? await getJsonFromReq(ctx.req)
            : objSameKeys(ctx.request.query, x => Array.isArray(x) ? x : tryJson(x))
        console.debug('API', ctx.method, ctx.path, { ...params })
        if (!apis.hasOwnProperty(ctx.path)) {
            ctx.body = 'invalid api'
            return ctx.status = 404
        }
        const csrf = ctx.cookies.get('csrf')
        // we don't rely on SameSite cookie option because it's https-only
        let res = csrf && csrf !== params.csrf ? new ApiError(UNAUTHORIZED, 'csrf')
            : await apis[ctx.path](params || {}, ctx)
        if (isAsyncGenerator(res))
            res = asyncGeneratorToReadable(res)
        if (res instanceof Readable) { // Readable, we'll go SSE-mode
            res.pipe(createSSE(ctx))
            const stillRes = res // satisfy ts
            ctx.req.on('close', () => // by closing the generated stream, creator of the stream will know the request is over without having to access anything else
                stillRes.destroy())
            return
        }
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

// offer an api for a generic dynamic list. Suitable to be the result of an api.
type SendListFunc<T> = (list:SendListReadable<T>) => void
export class SendListReadable<T> extends Readable {
    protected lastError: string | number | undefined
    constructor(addOrDoAtStart?: T[] | SendListFunc<T>) {
        super({ objectMode: true, read(){} })
        this.on('end', () =>
            this.destroy())
        if (!addOrDoAtStart)
            return
        if (typeof addOrDoAtStart === 'function') {
            setTimeout(() => addOrDoAtStart(this))
            return
        }
        for (const x of addOrDoAtStart)
            this.add(x)
        this.ready()
    }
    add(rec: T) {
        this.push({ add: rec })
    }
    remove(key: Partial<T>) {
        this.push({ remove: [key] })
    }
    update(search: Partial<T>, change: Partial<T>) {
        this.push({ update:[{ search, change }] })
    }
    close() {
        this.push(null)
    }
    ready() { // useful to indicate the end of an initial phase, but we leave open for updates
        this.push('ready')
    }
    error(msg: NonNullable<typeof this.lastError>) {
        this.push({ error: msg })
        this.lastError = msg
    }
    getLastError() {
        return this.lastError
    }
    custom(data: any) {
        this.push(data)
    }
    events(ctx: Koa.Context, eventMap: Parameters<typeof onOff>[1]) {
        const off = onOff(events, eventMap)
        ctx.res.once('close', off)
        return this
    }
    isClosed() {
        return this.destroyed
    }
}

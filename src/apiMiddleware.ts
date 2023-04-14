// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, onOff, removeStarting } from './misc'
import events from './events'
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_UNAUTHORIZED } from './const'
import _ from 'lodash'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error | object) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any>
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        const { params } = ctx
        console.debug('API', ctx.method, ctx.path, { ...params })
        const apiFun = apis.hasOwnProperty(ctx.path) && apis[ctx.path]!
        if (!apiFun) {
            ctx.body = 'invalid api'
            return ctx.status = HTTP_NOT_FOUND
        }
        const csrf = ctx.cookies.get('csrf')
        // we don't rely on SameSite cookie option because it's https-only
        let res
        try {
            for (const [k,v] of Object.entries(params))
                if (k.startsWith('uri') && typeof v === 'string')
                    params[k] = removeStarting(ctx.state.revProxyPath, v)
            res = csrf && csrf !== params.csrf ? new ApiError(HTTP_UNAUTHORIZED, 'csrf')
                : await apiFun(params || {}, ctx)
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
        if (res instanceof ApiError) {
            ctx.body = res.message
            return ctx.status = res.status
        }
        if (res instanceof Error) { // generic exception
            ctx.body = res.message || String(res)
            return ctx.status = HTTP_BAD_REQUEST
        }
        ctx.body = res
    }
}

function isAsyncGenerator(x: any): x is AsyncGenerator {
    return typeof (x as AsyncGenerator)?.next === 'function'
}

// offer an api for a generic dynamic list. Suitable to be the result of an api.
type SendListFunc<T> = (list:SendListReadable<T>) => void
export class SendListReadable<T> extends Readable {
    protected lastError: string | number | undefined
    protected buffer: any[] = []
    protected processBuffer: _.DebouncedFunc<any>
    constructor({ addAtStart, doAtStart, bufferTime }:{ bufferTime?: number, addAtStart?: T[], doAtStart?: SendListFunc<T> }={}) {
        super({ objectMode: true, read(){} })
        if (!bufferTime)
            bufferTime = 100
        this.processBuffer = _.debounce(() => {
            this.push(this.buffer)
            this.buffer = []
        }, bufferTime, { maxWait: bufferTime })
        this.on('end', () =>
            this.destroy())
        if (doAtStart)
            setTimeout(() => doAtStart(this)) // work later, when list object has been received by Koa
        if (addAtStart) {
            for (const x of addAtStart)
                this.add(x)
            this.ready()
        }
    }
    protected _push(rec: any) {
        this.buffer.push(rec)
        if (this.buffer.length > 10_000) // hard limit
            this.processBuffer.flush()
        else
            this.processBuffer()
    }
    add(rec: T | T[]) {
        this._push({ add: rec })
    }
    remove(key: Partial<T>) {
        this._push({ remove: [key] })
    }
    update(search: Partial<T>, change: Partial<T>) {
        this._push({ update:[{ search, change }] })
    }
    ready() { // useful to indicate the end of an initial phase, but we leave open for updates
        this._push('ready')
    }
    custom(data: any) {
        this._push(data)
    }
    props(props: object) {
        this._push({ props })
    }
    error(msg: NonNullable<typeof this.lastError>, close=false, props?: object) {
        this._push({ error: msg, ...props })
        this.lastError = msg
        if (close)
            this.close()
    }
    getLastError() {
        return this.lastError
    }
    close() {
        this.processBuffer.flush()
        this.push(null)
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

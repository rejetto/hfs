// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import createSSE from './sse'
import { Readable } from 'stream'
import { asyncGeneratorToReadable, LIST, onOff, removeStarting } from './misc'
import events from './events'
import { HTTP_BAD_REQUEST, HTTP_FOOL, HTTP_NOT_FOUND } from './const'
import _ from 'lodash'
import { defineConfig } from './config'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error | object) {
        super(typeof message === 'string' ? message : message && message instanceof Error ? message.message : JSON.stringify(message))
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | Readable | AsyncGenerator<any>
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

const logApi = defineConfig('log_api', true)

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        if (!logApi.get())
            ctx.state.dont_log = true
        const isPost = ctx.params
        const params = isPost ? ctx.params || {} : ctx.query
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
            return send(HTTP_BAD_REQUEST, res.message || String(res))
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

// offer an api for a generic dynamic list. Suitable to be the result of an api.
type SendListFunc<T> = (list:SendListReadable<T>) => void
export class SendListReadable<T> extends Readable {
    protected lastError: string | number | undefined
    protected buffer: any[] = []
    protected processBuffer: _.DebouncedFunc<any>
    constructor({ addAtStart, doAtStart, bufferTime, onEnd }:{ bufferTime?: number, addAtStart?: T[], doAtStart?: SendListFunc<T>, onEnd?: SendListFunc<T> }={}) {
        super({ objectMode: true, read(){} })
        if (!bufferTime)
            bufferTime = 200
        this.processBuffer = _.debounce(() => {
            this.push(this.buffer)
            this.buffer = []
        }, bufferTime, { maxWait: bufferTime })
        this.on('end', () => {
            onEnd?.(this)
            this.destroy()
        })
        setTimeout(() => doAtStart?.(this)) // work later, when list object has been received by Koa
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
        this._push([LIST.add, rec])
    }
    remove(search: Partial<T>) {
        const match = _.matches(search)
        const idx = _.findIndex(this.buffer, x => match(x[1]))
        const found = this.buffer[idx]
        const op = found?.[0]
        if (op === LIST.remove) return
        if (found) {
            this.buffer.splice(idx, 1)
            if (op === LIST.add) return
        }
        this._push([LIST.remove, search])
    }
    update(search: Partial<T>, change: Partial<T>) {
        if (_.isEmpty(change)) return
        const match = _.matches(search)
        const found = _.find(this.buffer, x => match(x[1]))
        const op = found?.[0]
        if (op === LIST.remove) return
        if (op === LIST.add || op === LIST.update)
            return Object.assign(found[op === LIST.add ? 1 : 2], change)
        return this._push([LIST.update, search, change])
    }
    ready() { // useful to indicate the end of an initial phase, but we leave open for updates
        this._push([LIST.ready])
    }
    custom(name: string, data: any) {
        this._push(data === undefined ? [name] : [name, data])
    }
    props(props: object) {
        this._push([LIST.props, props])
    }
    error(msg: NonNullable<typeof this.lastError>, close=false, props?: object) {
        this._push([LIST.error, msg, props])
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

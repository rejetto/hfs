import { IncomingMessage } from 'http'
import Koa from 'koa'
import EventEmitter from 'events'
import createSSE from './sse'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error) {
        super(typeof message === 'string' ? message : message?.message)
    }
}
type ApiHandlerResult = Record<string,any> | ApiError | EventEmitter
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

type ApiEmitter = (args:{ send: DataEmitter, end: EndEmitter, params:any, ctx: Koa.Context }) => void
type DataEmitter = (data:any) => void
type EndEmitter = () => void

export function apiEmitter(cb: ApiEmitter) {
    return (params:any, ctx: Koa.Context) => {
        const em = new EventEmitter()
        cb({
            send(data) {
                em.emit('data', data)
            },
            end() {
                em.emit('end')
            },
            params,
            ctx
        })
        return em
    }
}

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx) => {
        const params = ctx.method === 'POST' ? await getJsonFromReq(ctx.req) : ctx.request.query
        console.debug('API', ctx.method, ctx.path, { ...params })
        if (!apis.hasOwnProperty(ctx.path)) {
            ctx.body = 'invalid api'
            return ctx.status = 404
        }
        let res
        try {
            const csrf = ctx.cookies.get('csrf')
            if (csrf && csrf !== params.csrf)  // we don't rely on SameSite cookie option because it's https-only
                res = new ApiError(401, 'csrf')
            else
                res = await apis[ctx.path](params || {}, ctx)
        }
        catch(e) {
            ctx.throw(500, String(e))
        }
        if (res && res instanceof EventEmitter) {
            const sse = createSSE(ctx)
            res.on('data', data => sse.send(data))
            res.on('end', () => sse.close())
            return
        }
        if (!res) // this should happen only in case of SSE
            return
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

async function getJsonFromReq(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk =>
            data += chunk)
        req.on('error', reject)
        req.on('end', () => {
            try {
                resolve(JSON.parse(data))
            }
            catch(e) {
                reject(e)
            }
        })
    })
}

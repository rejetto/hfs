import Koa from 'koa'

export class ApiError extends Error {
    constructor(public status:number, message?:string | Error) {
        super(typeof message === 'string' ? message : message?.message)
    }
}
type ApiHandlerResult = Record<string,any> | ApiError
export type ApiHandler = (params:any, ctx:Koa.Context) => ApiHandlerResult | Promise<ApiHandlerResult>
export type ApiHandlers = Record<string, ApiHandler>

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.method === 'POST' ? ctx.request.body : ctx.request.query
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
        if (res)
            if (res instanceof ApiError) {
                ctx.body = res.message
                ctx.status = res.status
            }
            else if (res instanceof Error) {
                ctx.body = String(res)
                ctx.status = 400
            }
            else
                ctx.body = res
        await next()
    }
}


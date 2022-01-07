import Koa from 'koa'

export type ApiHandler = (params:any, ctx:Koa.Context) => any
export type ApiHandlers = Record<string, ApiHandler>

export function apiMiddleware(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.method === 'POST' ? ctx.request.body : ctx.request.query
        console.debug('API', ctx.method, ctx.path, { ...params })
        if (!(ctx.path in apis)) {
            ctx.body = 'invalid api'
            return ctx.status = 404
        }
        const cb = (apis as any)[ctx.path]
        let res
        try {
            res = await cb(params||{}, ctx)
        }
        catch(e) {
            ctx.throw(500, String(e))
        }
        if (res)
            if (res instanceof Error)
                ctx.throw(400, res)
            else
                ctx.body = res === true ? {} : res
        await next()
    }
}


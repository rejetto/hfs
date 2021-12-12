import glob from 'fast-glob'
import Koa from 'koa'

type ApiHandler = (params?:any, ctx?:any) => any
type ApiHandlers = Record<string, ApiHandler>

export function apiMw(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.request.body
        console.log('API', ctx.method, ctx.path, params)
        // @ts-ignore
        ctx.assert(ctx.path in apis, 404, 'invalid api')
        const cb = (apis as any)[ctx.path]
        const res = await cb(params, ctx)
        if (res)
            ctx.body = res
        await next()
    }
}

export const frontEndApis: ApiHandlers = {
    async file_list(params:any) {
        const res = await glob('.' + (params.path || '/') + '*', {
            stats: true,
            dot: true,
            markDirectories: true,
            onlyFiles: false,
        })
        const list = res.map(x => {
            const o = x.stats
            const folder = x.path.endsWith('/')
            return {
                n: x.name+(folder ? '/' : ''),
                c: o?.ctime,
                m: o?.mtime,
                s: folder ? undefined : o?.size,
            }
        })
        return { list }
    }
}

import Koa from 'koa'
import serve from 'koa-static'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import apis from './apis'
import { serveFrontend } from './frontend'
import { API_URI, DEV, FRONTEND_URI } from './const'

const PORT = 80

const srv = new Koa()
srv.use(async (ctx, next) => {
    console.debug(ctx.request.method, ctx.url) // log all requests
    // @ts-ignore
    ctx.assert(!ctx.originalUrl.includes('..'), 400, 'cross-dir') // prevent cross-dir
    await next()
})

srv.use(mount(API_URI, new Koa().use(bodyParser()).use(api(apis))))

const serveFiles = serve('.')
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontend)

srv.use(async (ctx, next) => {
    if (ctx.method === 'GET') {
        if (ctx.url.endsWith('/'))
            await serveFrontend(ctx,next)
        else if (ctx.url.startsWith(FRONTEND_URI))
            await serveFrontendPrefixed(ctx,next)
        else
            await serveFiles(ctx,next)
    }
    else
        await next()
})

srv.on('error', err => console.error('server error', err))
srv.listen(PORT, ()=> console.log('running on port', PORT, DEV, new Date().toLocaleString()))

type ApiHandler = (params?:any, ctx?:any) => any
type ApiHandlers = Record<string, ApiHandler>

function api(apis: ApiHandlers) : Koa.Middleware {
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

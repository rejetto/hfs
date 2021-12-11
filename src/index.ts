import Koa from 'koa'
import serve from 'koa-static'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import apis from './apis'
import { serveFrontend } from './frontend'

const PORT = 80
export const DEV = process.env.NODE_ENV === 'development' ? 'DEV' : ''
const SPECIAL_URI = '/~/'
export const FRONTEND_URI = SPECIAL_URI + 'front/'
const API_URI = SPECIAL_URI + 'api/'

if (DEV)
    console.clear()

const srv = new Koa()
srv.use(async (ctx, next) => {
    const r = ctx.request.req
    console.debug(r.method, r.url)
    await next()
})
srv.use(preventCrossDir())

srv.use(mount(API_URI, new Koa().use(bodyParser()).use(api(apis))))

const serveFiles = serve('.')

srv.use(async (ctx, next) => {
    if (ctx.method === 'GET') {
        if (ctx.url.endsWith('/'))
            await serveFrontend(ctx,next)
        else if (ctx.url.startsWith(FRONTEND_URI))
            await mount(FRONTEND_URI, serveFrontend)(ctx,next)
        else
            await serveFiles(ctx,next)
    }
    else
        await next()
})

srv.on('error', err => console.error('server error', err))
srv.listen(PORT, ()=> console.log('running on port', PORT, DEV, new Date().toLocaleString()))

function preventCrossDir() : Koa.Middleware {
    return async (ctx, next) => {
        // @ts-ignore
        ctx.assert(!ctx.originalUrl.includes('..'), 400, 'cross-dir');
        await next()
    }
}

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

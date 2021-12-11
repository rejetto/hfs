import Koa from 'koa'
import serve from 'koa-static'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import Router from '@koa/router'
import proxy from 'koa-better-http-proxy'
import apis from './apis'

const PORT = 80
const FRONTEND = 'frontend/build'
const DEV = process.env.NODE_ENV === 'development' ? 'DEV' : ''
const API_URI = '/~api/'

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

const router = new Router();
router.get('/(.*)', DEV ? proxy('localhost:3000', {}) : serve(FRONTEND))
srv.use(router.routes())

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

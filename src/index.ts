import Koa from 'koa'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import { apiMw, frontEndApis } from './apis'
import { serveFrontend } from './frontend'
import { API_URI, argv, DEV, FRONTEND_URI } from './const'
import { createReadStream } from 'fs'
import { vfs } from './vfs'
import { stat } from 'fs/promises'

const PORT = argv.port || 80

const srv = new Koa()
srv.use(async (ctx, next) => {
    // log all requests
    console.debug(new Date().toLocaleTimeString(), ctx.request.method, ctx.url)
    await next()
})

// serve apis
srv.use(mount(API_URI, new Koa().use(bodyParser()).use(apiMw(frontEndApis))))

// serve shared files and front-end files
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontend)
srv.use(async (ctx, next) => {
    const { path } = ctx
    if (ctx.method !== 'GET' || ctx.body)
        return await next()
    if (path.endsWith('/'))
        return await serveFrontend(ctx,next)
    if (path.startsWith(FRONTEND_URI))
        return await serveFrontendPrefixed(ctx,next)
    const node = vfs.urlToNode(decodeURI(path))
    if (!node)
        return await next()
    const { source } = node
    if (!source || (await stat(source)).isDirectory()) // this folder was requested without the trailing /
        return ctx.redirect(ctx.path+'/')
    if (source)
        ctx.body = createReadStream(source as string)
})

srv.on('error', err => {
    if (DEV && err.code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out
    console.error('server error', err)
})
srv.listen(PORT, ()=> console.log('running on port', PORT, DEV, new Date().toLocaleString()))

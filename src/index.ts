import Koa from 'koa'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import { apiMw, frontEndApis } from './apis'
import { serveFrontend } from './serveFrontend'
import { API_URI, argv, DEV, FRONTEND_URI } from './const'
import { serveFile } from './serveFile'
import { vfs } from './vfs'
import { isDirectory } from './misc'
import proxy from 'koa-better-http-proxy'
import compress from 'koa-compress'

const PORT = argv.port || 80

const srv = new Koa()
srv.use(async (ctx, next) => {
    // log all requests
    console.debug(new Date().toLocaleTimeString(), ctx.request.method, ctx.url)
    await next()
})

// serve apis
srv.use(mount(API_URI, new Koa()
    .use(bodyParser())
    .use(apiMw(frontEndApis))
    .use(compress({
        threshold: 2048,
        gzip: { flush: require('zlib').constants.Z_SYNC_FLUSH },
        deflate: { flush: require('zlib').constants.Z_SYNC_FLUSH },
        br: false // disable brotli
    }))
))

// serve shared files and front-end files
const serveFrontendPrefixed = mount(FRONTEND_URI.slice(0,-1), serveFrontend)
srv.use(async (ctx, next) => {
    const { path } = ctx
    if (ctx.method !== 'GET' || ctx.body)
        return await next()
    if (path.startsWith(FRONTEND_URI))
        return await serveFrontendPrefixed(ctx,next)
    const node = await vfs.urlToNode(decodeURI(path), ctx)
    if (!node)
        return await next()
    const { source } = node
    if (!source || await isDirectory(source)) // this folder was requested without the trailing /
        return path.endsWith('/') ? await serveFrontend(ctx,next)
            : ctx.redirect(ctx.path+'/')
    if (source)
        return source.includes('//') ? mount(path,proxy(source,{}))(ctx,next)
            : serveFile(source)(ctx,next)
    await next()
})

srv.on('error', err => {
    if (DEV && err.code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out
    if (err.code === 'ECONNRESET') return // someone interrupted, don't care
    console.error('server error', err)
})
srv.listen(PORT, ()=> console.log('running on port', PORT, DEV, new Date().toLocaleString()))

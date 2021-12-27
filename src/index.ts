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
import { Server } from 'http'
import { subscribe } from './config'
import session from 'koa-session'

const BUILD_TIMESTAMP = ""

const app = new Koa()
app.keys = ['hfs-keys-test']
app.use(session({
    key: 'hfs_$id',
    signed: true,
    rolling: true,
    maxAge: 30*60_000,
}, app))
app.use(async (ctx, next) => {
    // log all requests
    console.debug(new Date().toLocaleTimeString(), ctx.request.method, ctx.url)
    await next()
})

// serve apis
app.use(mount(API_URI, new Koa()
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
app.use(async (ctx, next) => {
    const { path } = ctx
    if (ctx.body)
        return await next()
    if (path.startsWith(FRONTEND_URI))
        return await serveFrontendPrefixed(ctx,next)
    const decoded = decodeURI(path)
    const node = await vfs.urlToNode(decoded, ctx)
    if (!node)
        return await next()
    const { source } = node
    if (!source || await isDirectory(source)) {
        if (!path.endsWith('/')) // this folder was requested without the trailing /
            return ctx.redirect(path + '/')
        if (node.default) {
            const def = await vfs.urlToNode(decoded + node.default, ctx)
            if (def)
                return serveFile(def)(ctx, next)
        }
        ctx.set({ server:'HFS '+BUILD_TIMESTAMP })
        return await serveFrontend(ctx, next)
    }
    if (source)
        return source.includes('//') ? mount(path,proxy(source,{}))(ctx,next)
            : serveFile(node)(ctx,next)
    await next()
})

app.on('error', err => {
    if (DEV && err.code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out
    if (err.code === 'ECONNRESET') return // someone interrupted, don't care
    console.error('server error', err)
})

let srv: Server
if (argv.port)
    listenOn(argv.port).then()
else
    subscribe('port', port =>
        listenOn(port||80))

async function listenOn(port: number) {
    await new Promise(resolve => {
        if (!srv)
            return resolve(null)
        srv.close(err => {
            if (err)
                console.debug('failed to stop server', err)
            resolve(err)
        })
    })
    await new Promise(resolve =>
        srv = app.listen(port, () => {
            console.log('running on port', port, DEV, new Date().toLocaleString())
            resolve(null)
        }))
}

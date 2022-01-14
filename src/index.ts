import Koa from 'koa'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import { apiMiddleware } from './apis'
import { API_URI, DEV} from './const'
import { Server } from 'http'
import { subscribeConfig } from './config'
import { frontEndApis } from './frontEndApis'
import { log } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { getAccount, getCurrentUsername } from './perm'
import { headRequests, gzipper, sessions, frontendAndSharedFiles } from './middlewares'

export const BUILD_TIMESTAMP = "-"

export const SESSION_DURATION = 30*60_000

console.log('started', new Date().toLocaleString())
console.log('build', BUILD_TIMESTAMP)
console.debug('cwd', process.cwd())
const app = new Koa()
app.keys = ['hfs-keys-test']
app.use(sessions(app))
app.use(async (ctx, next) => {
    ctx.account = getAccount(getCurrentUsername(ctx))
    await next()
})
app.use(headRequests)
app.use(log())
app.use(pluginsMiddleware())
app.use(throttler())
app.use(gzipper)

// serve apis
app.use(mount(API_URI, new Koa()
    .use(bodyParser())
    .use(apiMiddleware(frontEndApis))
))

app.use(frontendAndSharedFiles)

app.on('error', err => {
    if (DEV && err.code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out
    if (err.code === 'ECONNRESET') return // someone interrupted, don't care
    console.error('server error', err)
})

process.on('uncaughtException', err => {
    console.error(err)
})

let srv: Server
subscribeConfig({ k:'port', defaultValue: 80 }, async (port: number) => {
    await new Promise(resolve => {
        if (!srv)
            return resolve(null)
        srv.close(err => {
            if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING')
                console.debug('failed to stop server', String(err))
            resolve(err)
        })
    })
    await new Promise(resolve => {
        try {
            srv = app.listen(port, () => {
                console.log('running on port', port, DEV)
                resolve(null)
            }).on('error', e => {
                const { code } = e as any
                if (code === 'EADDRINUSE')
                    console.error(`couldn't listen on busy port ${port}`)
            })
        }
        catch(e) {
            console.error("couldn't listen on port", port, String(e))
        }

    })
})

import Koa from 'koa'
import mount from 'koa-mount'
import bodyParser from 'koa-bodyparser'
import { apiMiddleware } from './apis'
import { API_URI, DEV} from './const'
import { frontEndApis } from './frontEndApis'
import { log } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { getAccount, getCurrentUsername } from './perm'
import { headRequests, gzipper, sessions, frontendAndSharedFiles } from './middlewares'
import './listen'

export const BUILD_TIMESTAMP = "-"
export const SESSION_DURATION = 30*60_000

console.log('started', new Date().toLocaleString())
console.log('build', BUILD_TIMESTAMP, DEV)
console.debug('cwd', process.cwd())
export const app = new Koa()
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

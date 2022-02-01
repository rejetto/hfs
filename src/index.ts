import Koa from 'koa'
import mount from 'koa-mount'
import { apiMiddleware } from './apis'
import { API_URI, DEV} from './const'
import { frontEndApis } from './frontEndApis'
import { log } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { getAccount, getCurrentUsername, getCurrentUsernameExpanded } from './perm'
import { headRequests, gzipper, sessions, frontendAndSharedFiles } from './middlewares'
import './listen'
import { serveAdminFiles } from './serveFrontend'
import { adminApis } from './adminApis'

export const BUILD_TIMESTAMP = "-"
export const SESSION_DURATION = 30*60_000
export const HFS_STARTED = new Date()

console.log('started', HFS_STARTED.toLocaleString(), 'build', BUILD_TIMESTAMP, DEV)
console.debug('cwd', process.cwd())

const ADMIN_PORT = 63636
new Koa()
    .use(mount(API_URI, apiMiddleware(adminApis)))
    .use(serveAdminFiles)
    .on('error', errorHandler)
    .listen(ADMIN_PORT, '127.0.0.1', () =>
        console.log('admin interface on http://localhost:'+ADMIN_PORT))

export const app = new Koa({ keys: ['hfs-keys-test'] })
app.use(sessions(app))
app.use(async (ctx, next) => {
    ctx.state.usernames = getCurrentUsernameExpanded(ctx) // accounts chained via .belongs for permissions check
    ctx.state.account = getAccount(getCurrentUsername(ctx))
    await next()
})
app.use(headRequests)
app.use(log())
app.use(pluginsMiddleware())
app.use(throttler())
app.use(gzipper)

// serve apis
app.use(mount(API_URI, apiMiddleware(frontEndApis)))
app.use(frontendAndSharedFiles)
app.on('error', errorHandler)

function errorHandler(err:Error & { code:string, path:string }) {
    const { code } = err
    if (DEV && code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out dev stuff
    if (code === 'ECANCELED' || code === 'ECONNRESET' || code === 'ECONNABORTED') return // someone interrupted, don't care
    console.error('server error', err)
}

process.on('uncaughtException', err => {
    console.error(err)
})

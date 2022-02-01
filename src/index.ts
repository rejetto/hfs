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

export const BUILD_TIMESTAMP = "-"
export const SESSION_DURATION = 30*60_000

console.log('started', new Date().toLocaleString(), 'build', BUILD_TIMESTAMP, DEV)
console.debug('cwd', process.cwd())
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

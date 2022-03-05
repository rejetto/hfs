// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import mount from 'koa-mount'
import { apiMiddleware } from './apis'
import { API_URI, BUILD_TIMESTAMP, DEV, HFS_STARTED, VERSION} from './const'
import { frontEndApis } from './frontEndApis'
import { log } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { headRequests, gzipper, sessions, frontendAndSharedFiles, someSecurity, prepareState } from './middlewares'
import './listen'
import { serveAdminFiles } from './serveFrontend'
import { adminApis } from './adminApis'

if (DEV) console.clear()
console.log('started', HFS_STARTED.toLocaleString(), DEV)
console.log('version', VERSION||'-')
console.log('build', BUILD_TIMESTAMP||'-')
console.debug('cwd', process.cwd())

const keys = ['hfs-keys-test']

export const adminApp = new Koa({ keys })
adminApp.use(someSecurity)
    .use(sessions(adminApp))
    .use(prepareState(true))
    .use(gzipper)
    .use(mount(API_URI, apiMiddleware(adminApis)))
    .use(serveAdminFiles)
    .on('error', errorHandler)

export const frontendApp = new Koa({ keys })
frontendApp.use(someSecurity)
    .use(sessions(frontendApp))
    .use(prepareState())
    .use(headRequests)
    .use(log())
    .use(pluginsMiddleware())
    .use(throttler())
    .use(gzipper)
    .use(mount(API_URI, apiMiddleware(frontEndApis)))
    .use(frontendAndSharedFiles)
    .on('error', errorHandler)

function errorHandler(err:Error & { code:string, path:string }) {
    const { code } = err
    if (DEV && code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out dev stuff
    if (code === 'ECANCELED' || code === 'ECONNRESET' || code === 'ECONNABORTED') return // someone interrupted, don't care
    console.error('server error', err)
}

process.on('uncaughtException', err => {
    console.error(err)
})

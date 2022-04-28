// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import mount from 'koa-mount'
import { apiMiddleware } from './apiMiddleware'
import { API_URI, DEV } from './const'
import { frontEndApis } from './frontEndApis'
import { log } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { headRequests, gzipper, sessions, serveGuiAndSharedFiles, someSecurity, prepareState } from './middlewares'
import './listen'
import { adminApis } from './adminApis'
import { defineConfig } from './config'
import { ok } from 'assert'
import _ from 'lodash'

ok(_.intersection(Object.keys(frontEndApis), Object.keys(adminApis)).length === 0) // they share same endpoints

const keys = ['hfs-keys-test']
export const app = new Koa({ keys })
app.use(someSecurity)
    .use(sessions(app))
    .use(prepareState)
    .use(headRequests)
    .use(log())
    .use(pluginsMiddleware())
    .use(throttler)
    .use(gzipper)
    .use(mount(API_URI, apiMiddleware({ ...frontEndApis, ...adminApis })))
    .use(serveGuiAndSharedFiles)
    .on('error', errorHandler)

function errorHandler(err:Error & { code:string, path:string }) {
    const { code } = err
    if (DEV && code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out dev stuff
    if (code === 'ECANCELED' || code === 'ECONNRESET' || code === 'ECONNABORTED') return // someone interrupted, don't care
    console.error('server error', err)
}

process.on('uncaughtException', err => {
    if ((err as any).syscall !== 'watch')
        console.error(err)
})

defineConfig('proxies', 0).sub(n => {
    app.proxy = n > 0
    app.maxIpsCount = n
})

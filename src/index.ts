#!/usr/bin/env node
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import mount from 'koa-mount'
import './consoleLog'
import { apiMiddleware } from './apiMiddleware'
import { API_URI, DEV, VERSION } from './const'
import { frontEndApis } from './frontEndApis'
import { logMw } from './log'
import { pluginsMiddleware } from './plugins'
import { throttler } from './throttler'
import { headRequests, gzipper, serveGuiAndSharedFiles, someSecurity, prepareState, paramsDecoder } from './middlewares'
import './listen'
import './commands'
import { adminApis } from './adminApis'
import { defineConfig } from './config'
import { ok } from 'assert'
import _ from 'lodash'
import { randomId } from './misc'
import session from 'koa-session'
import { selfCheckMiddleware } from './selfCheck'
import { acmeMiddleware } from './acme'
import './geo'
import { geoFilter } from './geo'

ok(_.intersection(Object.keys(frontEndApis), Object.keys(adminApis)).length === 0) // they share same endpoints, don't clash

process.title = 'HFS ' + VERSION
const keys = process.env.COOKIE_SIGN_KEYS?.split(',')
    || [randomId(30)] // randomness at start gives some extra security, btu also invalidates existing sessions
export const app = new Koa({ keys })
app.use(someSecurity)
    .use(acmeMiddleware)
    .use(session({ key: 'hfs_$id', signed: true, rolling: true, sameSite: 'lax' }, app))
    .use(prepareState)
    .use(geoFilter)
    .use(selfCheckMiddleware)
    .use(gzipper)
    .use(paramsDecoder) // must be done before plugins, so they can manipulate params
    .use(pluginsMiddleware)
    .use(headRequests)
    .use(logMw)
    .use(throttler)
    .use(mount(API_URI, apiMiddleware({ ...frontEndApis, ...adminApis })))
    .use(serveGuiAndSharedFiles)
    .on('error', errorHandler)

function errorHandler(err:Error & { code:string, path:string }) {
    const { code } = err
    if (DEV && code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out dev stuff
    if (code === 'ECANCELED' || code === 'ECONNRESET' || code === 'ECONNABORTED'  || code === 'EPIPE'
        || code === 'ERR_STREAM_WRITE_AFTER_END' // happens disconnecting uploads, don't care
        || code === 'HPE_INVALID_METHOD' // cannot serve you like that
        || code === 'HPE_INVALID_EOF_STATE') return // someone interrupted, don't care
    console.error('server error', err)
}

process.on('uncaughtException', err => {
    if ((err as any).syscall !== 'watch')
        console.error("uncaught:", err)
})

defineConfig('proxies', 0).sub(n => {
    app.proxy = n > 0
    app.maxIpsCount = n
})

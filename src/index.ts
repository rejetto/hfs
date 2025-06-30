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
import { headRequests, gzipper, someSecurity, prepareState, paramsDecoder, sessionMiddleware } from './middlewares'
import { serveGuiAndSharedFiles } from './serveGuiAndSharedFiles'
import './listen'
import './commands'
import { adminApis } from './adminApis'
import { defineConfig } from './config'
import { ok } from 'assert'
import _ from 'lodash'
import { randomId } from './misc'
import { selfCheckMiddleware } from './selfCheck'
import { acmeMiddleware } from './acme'
import './geo'
import { geoFilter } from './geo'
import { rootsMiddleware } from './roots'
import events from './events'
import { trackIpsMw } from './ips'

ok(_.intersection(Object.keys(frontEndApis), Object.keys(adminApis)).length === 0) // they share same endpoints, don't clash

process.title = 'HFS ' + VERSION
const keys = process.env.COOKIE_SIGN_KEYS?.split(',')
    || [randomId(30)] // randomness at start gives some extra security, btu also invalidates existing sessions
export const app = new Koa({ keys })
app.use(sessionMiddleware)
    .use(selfCheckMiddleware)
    .use(acmeMiddleware)
    .use(someSecurity)
    .use(prepareState)
    .use(geoFilter)
    .use(trackIpsMw)
    .use(gzipper)
    .use(paramsDecoder) // must be done before plugins, so they can manipulate params
    .use(headRequests)
    .use(rootsMiddleware)
    .use(logMw)
    .use(throttler)
    .use(pluginsMiddleware)
    .use(mount(API_URI, apiMiddleware({ ...frontEndApis, ...adminApis })))
    .use(serveGuiAndSharedFiles)
    .on('error', errorHandler)
events.emit('app', app)

function errorHandler(err:Error & { code:string, path:string }) {
    const { code } = err
    if (DEV && code === 'ENOENT' && err.path.endsWith('sockjs-node')) return // spam out dev stuff
    if (code === 'ECANCELED' || code === 'ECONNRESET' || code === 'ECONNABORTED'  || code === 'EPIPE'
        || code === 'ERR_STREAM_WRITE_AFTER_END' // happens disconnecting uploads, don't care
        || code === 'ERR_STREAM_PREMATURE_CLOSE' // happens when many files are sent (not locally), but I checked that the files are written completely. Introduced after node18.5.0 and is thrown by pipeline() used by PUT method handler.
        || code === 'HPE_INVALID_METHOD' // cannot serve you like that
        || code === 'HPE_CLOSED_CONNECTION' // uploads with wrong content-length, but we already handle that properly
        || code === 'HPE_INVALID_EOF_STATE') return // someone interrupted, don't care
    console.error('server error', err)
}

process.on('uncaughtException', (err: any) => {
    if (err.syscall !== 'watch' && err.code !== 'ECONNRESET' && err.code !== 'EIO') // EIO seems to happen when the terminal is closed
        try { console.error("uncaught:", err) }
        catch {} // in case we are writing to a closed terminal, we may throw with "write eio at afterwritedispatched", causing an infinite loop
})
// this warning is scaring users, and has been removed in node 20.12.0 https://github.com/nodejs/node/pull/51204
const original = process.emitWarning
process.emitWarning = warn => String(warn).startsWith('An error event has already been emitted') || original.call(process, warn)

defineConfig('proxies', 0).sub(n => {
    app.proxy = n > 0
    app.maxIpsCount = n
})

declare module "koa" {
    interface BaseContext {
        isAborted(): boolean
    }
}
app.context.isAborted = function() {
    return this.res.destroyed || this.req.aborted // investigate: "aborted" is deprecated, but "destroyed" will cause failure of some tests
}

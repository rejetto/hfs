// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import { API_URI, DEV, HTTP_FOOL } from './const'
import { DAY, dirTraversal, isLocalHost, splitAt, stream2string, tryJson } from './misc'
import { Readable } from 'stream'
import { applyBlock } from './block'
import { Account, accountCanLogin, getAccount } from './perm'
import { Connection, normalizeIp, socket2connection, updateConnectionForCtx } from './connections'
import { invalidateSessionBefore, setLoggedIn, srpCheck } from './auth'
import { constants } from 'zlib'
import { getHttpsWorkingPort } from './listen'
import { defineConfig } from './config'
import session from 'koa-session'
import { app } from './index'
import events from './events'

const allowSessionIpChange = defineConfig<boolean | 'https'>('allow_session_ip_change', false)
const forceHttps = defineConfig('force_https', true)
const ignoreProxies = defineConfig('ignore_proxies', false)
export const sessionDuration = defineConfig('session_duration', Number(process.env.SESSION_DURATION) || DAY/1000,
    v => v * 1000)

export const gzipper = compress({
    threshold: 2048,
    gzip: { flush: constants.Z_SYNC_FLUSH },
    deflate: { flush: constants.Z_SYNC_FLUSH },
    br: false, // disable brotli
    filter(type) {
        return /text|javascript|style/i.test(type)
    },
})

export const headRequests: Koa.Middleware = async (ctx, next) => {
    const head = ctx.method === 'HEAD'
    if (head)
        ctx.method = 'GET' // let other middlewares work, so we can collect the size at the end
    await next()
    if (!head || ctx.body === undefined) return
    const { length, status } = ctx.response
    if (ctx.body)
        ctx.body = Readable.from('') // empty the body for this is a HEAD request. Using Readable avoids koa from trying to set length to 0
    ctx.status = status
    if (length)
        ctx.response.length = length
}

let proxyDetected: undefined | Koa.Context
export const someSecurity: Koa.Middleware = (ctx, next) => {
    ctx.request.ip = normalizeIp(ctx.ip)
    const ss = ctx.session
    if (ss?.username && (!allowSessionIpChange.get() || !ctx.secure && allowSessionIpChange.get() === 'https'))
        if (!ss.ip)
            ss.ip = ctx.ip
        else if (ss.ip !== ctx.ip) {
            delete ss.username
            ss.ip = ctx.ip
        }

    try {
        if (dirTraversal(decodeURI(ctx.path)))
            return ctx.status = HTTP_FOOL
        if (!ctx.state.skipFilters && applyBlock(ctx.socket, ctx.ip))
            return

        if (!ctx.ips.length && ctx.get('X-Forwarded-For') // empty ctx.ips implies we didn't configure for proxies
        // we have some dev-proxies to ignore
        && !(DEV && [process.env.FRONTEND_PROXY, process.env.ADMIN_PROXY].includes(ctx.get('X-Forwarded-port')))) {
            proxyDetected = ctx
            ctx.state.whenProxyDetected = new Date()
        }
    }
    catch {
        return ctx.status = HTTP_FOOL
    }
    if (!ctx.secure && forceHttps.get() && getHttpsWorkingPort() && !isLocalHost(ctx)) {
        const { URL } = ctx
        URL.protocol = 'https'
        URL.port = getHttpsWorkingPort()
        ctx.status = 307 // this ensures the client doesn't switch to a simpler GET request
        return ctx.redirect(URL.href)
    }
    return next()
}

// limited to http proxies
export function getProxyDetected() {
    if (proxyDetected?.state.whenProxyDetected < Date.now() - DAY)
        proxyDetected = undefined
    return !ignoreProxies.get() && proxyDetected
        && { from: proxyDetected.ip, for: proxyDetected.get('X-Forwarded-For') }
}

export const prepareState: Koa.Middleware = async (ctx, next) => {
    if (ctx.session?.username) {
        if (ctx.session.ts < invalidateSessionBefore.get(ctx.session.username)!)
            delete ctx.session.username
        ctx.session.maxAge = sessionDuration.compiled()
    }
    // calculate these once and for all
    ctx.state.connection = socket2connection(ctx.socket)!
    const a = ctx.state.account = await urlLogin() || await getHttpAccount() || getAccount(ctx.session?.username, false)
    if (a && !accountCanLogin(a))
        ctx.state.account = undefined
    ctx.state.revProxyPath = ctx.get('x-forwarded-prefix')
    updateConnectionForCtx(ctx)
    await next()

    function urlLogin() {
        const { login }  = ctx.query
        if (!login) return
        const [u, p] = splitAt(':', String(login))
        ctx.redirect(ctx.originalUrl.slice(0, -ctx.querystring.length-1)) // redirect to hide credentials
        return doLogin(u, p)
    }

    function getHttpAccount() {
        const b64 = ctx.get('authorization')?.split(' ')[1]
        if (!b64) return
        try {
            const [u, p] = atob(b64).split(':')
            return doLogin(u!, p||'')
        }
        catch {}
    }

    async function doLogin(u: string, p: string) {
        if (!u || u === ctx.session?.username) return // providing credentials, but not needed
        await events.emitAsync('attemptingLogin', { ctx, username: u })
        const a = await srpCheck(u, p)
        if (a) {
            await setLoggedIn(ctx, a.username)
            ctx.headers['x-username'] = a.username // give an easier way to determine if the login was successful
        }
        else if (u)
            events.emit('failedLogin', ctx, { username: u })
        return a
    }
}

declare module "koa" {
    interface DefaultState {
        params: Record<string, any>
        account?: Account // user logged in
        revProxyPath: string
        connection: Connection
    }
}
export const paramsDecoder: Koa.Middleware = async (ctx, next) => {
    ctx.state.params = ctx.method === 'POST' && ctx.originalUrl.startsWith(API_URI)
        && (tryJson(await stream2string(ctx.req)) || {})
    await next()
}

// once https cookie is created, http cannot do the same. The solution is to use 2 different cookies.
// But koa-session doesn't support 2 cookies, so I made this hacky solution: keep track of the options object, to modify the key at run-time.
let internalSessionMw: any
let options: any
events.once('app', () => // wait for app to be defined
    internalSessionMw = session(options = { signed: true, rolling: true, sameSite: 'lax' } as const, app) )
export const sessionMiddleware: Koa.Middleware = (ctx, next) => {
    options.key = 'hfs_' + ctx.protocol
    return internalSessionMw(ctx, next)
}
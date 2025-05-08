// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import compress from 'koa-compress'
import Koa from 'koa'
import { API_URI, DEV, HTTP_FOOL } from './const'
import { ALLOW_SESSION_IP_CHANGE, DAY, dirTraversal, isLocalHost, netMatches, splitAt, stream2string, tryJson } from './misc'
import { Readable } from 'stream'
import { applyBlock } from './block'
import { Account, accountCanLogin, getAccount, getFromAccount } from './perm'
import { Connection, normalizeIp, socket2connection, updateConnectionForCtx } from './connections'
import { clearTextLogin, invalidateSessionBefore } from './auth'
import { constants } from 'zlib'
import { getHttpsWorkingPort } from './listen'
import { defineConfig } from './config'
import session from 'koa-session'
import { app } from './index'
import events from './events'

const forceHttps = defineConfig('force_https', true)
defineConfig('ignore_proxies', false)
const allowAuthorizationHeader = defineConfig('authorization_header', true)
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
export let cloudflareDetected: undefined | Date
export const someSecurity: Koa.Middleware = (ctx, next) => {
    ctx.request.ip = normalizeIp(ctx.ip)
    const ss = ctx.session
    if (ss?.username && !ss?.[ALLOW_SESSION_IP_CHANGE])
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

        if (ctx.get('X-Forwarded-For')
        // we have some dev-proxies to ignore
        && !(DEV && [process.env.FRONTEND_PROXY, process.env.ADMIN_PROXY].includes(ctx.get('X-Forwarded-port')))) {
            proxyDetected = ctx
            ctx.state.whenProxyDetected = new Date()
        }
        if (ctx.get('cf-ray'))
            cloudflareDetected = new Date()
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
    if (proxyDetected?.state.whenProxyDetected < Date.now() - DAY) // detection is reset after a day
        proxyDetected = undefined
    return proxyDetected && { from: proxyDetected.socket.remoteAddress, for: proxyDetected.get('X-Forwarded-For') }
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
    if (a && (!accountCanLogin(a) || failAllowNet(ctx, a))) // enforce allow_net also after login
        ctx.state.account = undefined
    ctx.state.revProxyPath = ctx.get('x-forwarded-prefix')
    updateConnectionForCtx(ctx)
    await next()

    function urlLogin() {
        const { login }  = ctx.query
        if (!login) return
        const [u, p] = splitAt(':', String(login))
        ctx.redirect(ctx.originalUrl.slice(0, -ctx.querystring.length-1)) // redirect to hide credentials
        return u && clearTextLogin(ctx, u, p, 'url')
    }

    function getHttpAccount() {
        const b64 = allowAuthorizationHeader.get() && ctx.get('authorization')?.split(' ')[1]
        if (!b64) return
        try {
            const [u, p] = atob(b64).split(':')
            if (!u || u === ctx.session?.username) return // providing credentials, but not needed
            return clearTextLogin(ctx, u, p||'', 'header')
        }
        catch {}
    }
}

export function failAllowNet(ctx: Koa.Context, a: Account | undefined) {
    const cached = ctx.session?.allowNet // won't reflect changes until session is terminated
    const mask = cached ?? getFromAccount(a || '', a => a.allow_net)
    if (!cached && mask && ctx.session?.username)
        ctx.session.allowNet = mask // must be deleted on logout by setLoggedIn
    const ret = mask && !netMatches(ctx.ip, mask, true)
    if (ret)
        console.debug("login failed: allow_net")
    return ret
}

declare module "koa" {
    interface DefaultState {
        params: Record<string, any>
        account?: Account // user logged in
        revProxyPath: string // must not have final slash
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
import Koa from 'koa'
import { clearTextLogin, getCurrentUsername, setLoggedIn } from './auth'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED, HTTP_UNAUTHORIZED } from './cross-const'
import { escapeHTML, readRequestBodyLimited, try_ } from './misc'
import { randomUUID } from 'node:crypto'
import { accountCanLogin } from './perm'
import { failAllowNet } from './middlewares'
import events from './events'

export async function handleBasicAuth(ctx: Koa.Context) {
    const { get } = ctx.query
    if (get !== 'login' && get !== 'logout') return false
    ctx.set('Cache-Control', 'no-store')
    if (ctx.method === 'POST') {
        if (ctx.request.type !== 'application/x-www-form-urlencoded') {
            ctx.status = HTTP_BAD_REQUEST
            return true
        }
        const body = await readRequestBodyLimited(ctx, 16 * 1024)
        if (!body) return true
        const fields = new URLSearchParams(body.text)
        // a session-bound token also protects legacy browsers without Origin or SameSite support
        if (!ctx.session?.basicAuthToken || fields.get('csrf') !== ctx.session.basicAuthToken) {
            ctx.status = HTTP_FORBIDDEN
            ctx.body = "Cookies are required. Reload the login page and try again."
            return true
        }
        if (get === 'logout') {
            await setLoggedIn(ctx, false)
            ctx.redirect(localReturnUrl(ctx, fields.get('returnTo') || ctx.get('referer')))
            ctx.status = 303
        }
        else {
            const username = fields.get('username') || ''
            const password = fields.get('password') || ''
            let loggedIn = false
            try {
                const account = await clearTextLogin(ctx, username, password, 'body')
                if (account && accountCanLogin(account) && !failAllowNet(ctx, account)) {
                    ctx.state.params = { username, password }
                    await setLoggedIn(ctx, account.username, 'body')
                    loggedIn = true
                }
            }
            catch {
                events.emit('failedLogin', { ctx, username, via: 'body' })
            }
            if (loggedIn) {
                ctx.redirect(localReturnUrl(ctx, fields.get('returnTo')))
                ctx.status = 303
            }
            else
                basicLoginForm(ctx, fields.get('returnTo') || '', "Invalid username or password.")
        }
    }
    else if (ctx.state.getOrHead) {
        if (get === 'login' && getCurrentUsername(ctx))
            ctx.redirect(localReturnUrl(ctx, ctx.get('referer')))
        else if (get === 'logout') {
            ctx.type = 'html'
            ctx.body = `<form method="post"><input type="hidden" name="csrf" value="${getBasicAuthToken(ctx)}"><button type="submit">Logout</button></form>`
        }
        else
            basicLoginForm(ctx, ctx.get('referer'))
    }
    else
        ctx.status = HTTP_METHOD_NOT_ALLOWED
    return true
}

export function basicLoginForm(ctx: Koa.Context, returnTo = (ctx.state.revProxyPath || '') + ctx.originalUrl, error = '') {
    ctx.type = 'html'
    ctx.set('Cache-Control', 'no-store')
    ctx.body = `<meta name="viewport" content="width=device-width"><title>Login</title>
<h1>Login</h1>${error ? `<p>${escapeHTML(error)}</p>` : ''}
<form method="post" action="${escapeHTML(basicAuthRoot(ctx) + '?get=login')}">
<input type="hidden" name="csrf" value="${getBasicAuthToken(ctx)}">
<input type="hidden" name="returnTo" value="${escapeHTML(localReturnUrl(ctx, returnTo))}">
<p><label>Username: <input name="username" autocomplete="username" required></label></p>
<p><label>Password: <input type="password" name="password" autocomplete="current-password" required></label></p>
<button type="submit">Login</button></form><p>Cookies are required to log in.</p>`
    ctx.status = error || ctx.status === HTTP_UNAUTHORIZED ? HTTP_UNAUTHORIZED : 200
}

function localReturnUrl(ctx: Koa.Context, value: string | null) {
    const fallback = basicAuthRoot(ctx) + '?get=basic'
    const url = value && try_(() => new URL(value, ctx.URL))
    // retain the origin so local paths starting with // cannot become external redirects
    return url && url.origin === ctx.URL.origin && !url.username && !url.password
        && !['login', 'logout'].includes(url.searchParams.get('get') || '')
        ? url.origin + url.pathname + url.search + url.hash : fallback
}

export function basicAuthRoot(ctx: Koa.Context) {
    const url = try_(() => new URL((ctx.state.revProxyPath || '') + '/', ctx.URL))
    return url && url.origin === ctx.URL.origin && !url.username && !url.password
        ? url.origin + url.pathname : ctx.URL.origin + '/'
}

export function getBasicAuthToken(ctx: Koa.Context) {
    return ctx.session!.basicAuthToken ||= randomUUID()
}

declare module "koa-session" {
    interface Session {
        basicAuthToken?: string
    }
}

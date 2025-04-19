import { defineConfig, getConfig } from './config'
import {
    ADMIN_URI, API_URI, Callback, CFG, isLocalHost, join, makeMatcher, removeStarting, SPECIAL_URI, try_,
    enforceFinal, enforceStarting
} from './misc'
import Koa from 'koa'
import { disconnect } from './connections'
import { baseUrl } from './listen'
import _ from 'lodash'

export const roots = defineConfig(CFG.roots, {} as { [hostMask: string]: string }, map => {
    const list = Object.keys(map)
    const matchers = list.map(hostMask => makeMatcher(hostMask))
    const values = Object.values(map).map(x => enforceFinal('/', enforceStarting('/', x)))
    return (host: string) => values[matchers.findIndex(m => m(host))]
})
const forceAddress = defineConfig(CFG.force_address, false)
forceAddress.sub((v, { version }) => { // convert from legacy configs
    if (version?.olderThan('0.53.0-alpha2'))
        forceAddress.set(getConfig('force_base_url') || getConfig('roots_mandatory') || false)
})

export const rootsMiddleware: Koa.Middleware = (ctx, next) =>
    (() => {
        ctx.state.originalPath = ctx.path
        let params: undefined | typeof ctx.state.params | typeof ctx.query // undefined if we are not going to work on api parameters
        if (ctx.path.startsWith(SPECIAL_URI)) { // special uris should be excluded...
            if (!ctx.path.startsWith(API_URI)) return // ...unless it's an api
            params = ctx.state.params || ctx.query // for api we'll translate params
            changeUriParams(v => removeStarting(ctx.state.revProxyPath, v))  // this removal must be done before adding the root; this operation doesn't conceptually belong to "roots", and it may be placed in different middleware, but it's convenient to do it here
            const { referer } = ctx.headers
            if (referer && try_(() => new URL(referer).pathname.startsWith(ctx.state.revProxyPath + ADMIN_URI))) return // exclude apis for admin-panel
        }
        if (_.isEmpty(roots.get())) return
        const root = ctx.state.root = roots.compiled()?.(ctx.host)
        if (!ctx.state.skipFilters && forceAddress.get())
            if (root === undefined && !isLocalHost(ctx) && ctx.host !== baseUrl.compiled()) {
                disconnect(ctx, forceAddress.key())
                return true // true will avoid calling next
            }
        if (!root || root === '/') return // no transformation is required
        changeUriParams(v => join(root, v))
        if (!params)
            ctx.path = join(root, ctx.path)

        function changeUriParams(cb: Callback<string, string>) {
            if (!params) return
            for (const [k, v] of Object.entries(params))
                if (k.startsWith('uri'))
                    params[k] = Array.isArray(v) ? v.map(cb) : cb(v)
        }
    })() || next()

declare module "koa" {
    interface DefaultState {
        originalPath: string // before roots is applied
        root?: string
    }
}
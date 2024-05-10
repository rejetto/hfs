import { defineConfig, getConfig } from './config'
import { ADMIN_URI, API_URI, CFG, isLocalHost, makeMatcher, SPECIAL_URI } from './misc'
import Koa from 'koa'
import { disconnect } from './connections'
import { baseUrl } from './listen'

export const roots = defineConfig(CFG.roots, {} as { [hostMask: string]: string }, map => {
    const list = Object.keys(map)
    const matchers = list.map(hostMask => makeMatcher(hostMask))
    const values = Object.values(map)
    return (host: string) => values[matchers.findIndex(m => m(host))]
})
const forceAddress = defineConfig(CFG.force_address, false)
forceAddress.sub((v, { version }) => { // convert from legacy configs
    if (version?.olderThan('0.53.0'))
        forceAddress.set(getConfig('force_base_url') || getConfig('roots_mandatory') || false)
})

export const rootsMiddleware: Koa.Middleware = (ctx, next) =>
    (() => {
        ctx.state.originalPath = ctx.path
        const root = roots.compiled()?.(ctx.host)
        if (!ctx.state.skipFilters && forceAddress.get())
            if (root === undefined && !isLocalHost(ctx) && ctx.host !== baseUrl.compiled()) {
                disconnect(ctx, forceAddress.key())
                return true // true will avoid calling next
            }
        if (!root || root === '/') return // not transformation is required
        let params: undefined | typeof ctx.state.params | typeof ctx.query // undefined if we are not going to work on api parameters
        if (ctx.path.startsWith(SPECIAL_URI)) { // special uris should be excluded...
            if (!ctx.path.startsWith(API_URI)) return // ...unless it's an api
            let { referer } = ctx.headers
            referer &&= new URL(referer).pathname
            if (referer?.startsWith(ctx.state.revProxyPath + ADMIN_URI)) return // exclude apis for admin-panel
            params = ctx.state.params || ctx.query // for api we'll translate params
        }
        if (!params) {
            ctx.path = join(root, ctx.path)
            return
        }
        for (const [k,v] of Object.entries(params))
            if (k.startsWith('uri'))
                params[k] = Array.isArray(v) ? v.map(x => join(root, x)) : join(root, v)
    })() || next()

function join(a: string, b: any) {
    return a + (b && b[0] !== '/' ? '/' : '') + b
}

declare module "koa" {
    interface DefaultState {
        originalPath: string // before roots is applied
    }
}
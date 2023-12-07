import { defineConfig } from './config'
import { ADMIN_URI, API_URI, CFG, isLocalHost, makeMatcher, SPECIAL_URI } from './misc'
import Koa from 'koa'
import { disconnect } from './connections'

export const roots = defineConfig(CFG.roots, [] as { host: string, root: string }[], list => {
    const matchers = list.map((row: any) => typeof row?.host === 'string' ? makeMatcher(row.host) : () => false)
    return (host: string) => list[matchers.findIndex(m => m(host))]
})
const rootsMandatory = defineConfig(CFG.roots_mandatory, false)

export const rootsMiddleware: Koa.Middleware = (ctx, next) =>
    (() => {
        let params: undefined | typeof ctx.params | typeof ctx.query // undefined if we are not going to work on api parameters
        if (ctx.path.startsWith(SPECIAL_URI)) { // special uris should be excluded...
            if (!ctx.path.startsWith(API_URI)) return // ...unless it's an api
            let { referer } = ctx.headers
            referer &&= new URL(referer).pathname
            if (referer?.startsWith(ctx.state.revProxyPath + ADMIN_URI)) return // exclude apis for admin-panel
            params = ctx.params || ctx.query // for api we'll translate params
        }
        if (!roots.get()?.length) return
        const row = roots.compiled()(ctx.host)
        if (!row) {
            if (!rootsMandatory.get() || isLocalHost(ctx)) return
            disconnect(ctx)
            return true // true will avoid calling next
        }
        const { root='' } = row
        if (!root || root === '/') return
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
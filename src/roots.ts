import { defineConfig } from './config'
import { ADMIN_URI, API_URI, CFG, isLocalHost, makeMatcher, SPECIAL_URI } from './misc'
import Koa from 'koa'
import { disconnect } from './connections'
import _ from 'lodash'

export const roots = defineConfig(CFG.roots, {} as { [hostMask: string]: string }, map => {
    if (_.isArray(map)) { // legacy pre 0.51.0-alpha5, remove in 0.52
        roots.set(Object.fromEntries(map.map(x => [x.host, x.root])))
        return
    }
    const list = Object.keys(map)
    const matchers = list.map(hostMask => makeMatcher(hostMask))
    const values = Object.values(map)
    return (host: string) => values[matchers.findIndex(m => m(host))]
})
const rootsMandatory = defineConfig(CFG.roots_mandatory, false)

export const rootsMiddleware: Koa.Middleware = (ctx, next) =>
    (() => {
        let params: undefined | typeof ctx.state.params | typeof ctx.query // undefined if we are not going to work on api parameters
        if (ctx.path.startsWith(SPECIAL_URI)) { // special uris should be excluded...
            if (!ctx.path.startsWith(API_URI)) return // ...unless it's an api
            let { referer } = ctx.headers
            referer &&= new URL(referer).pathname
            if (referer?.startsWith(ctx.state.revProxyPath + ADMIN_URI)) return // exclude apis for admin-panel
            params = ctx.state.params || ctx.query // for api we'll translate params
        }
        if (_.isEmpty(roots.get())) return
        const host2root = roots.compiled()
        if (!host2root) return
        const root = host2root(ctx.host)
        if (root === '' || root === '/') return
        if (root === undefined) {
            if (ctx.state.skipFilters || !rootsMandatory.get() || isLocalHost(ctx)) return
            disconnect(ctx, 'no-root')
            return true // true will avoid calling next
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
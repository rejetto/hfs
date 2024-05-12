import { defineConfig } from './config'
import { ADMIN_URI, API_URI, Callback, CFG, isLocalHost, makeMatcher, removeStarting, SPECIAL_URI } from './misc'
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
            params = ctx.state.params || ctx.query // for api we'll translate params
            changeUriParams(v => removeStarting(ctx.state.revProxyPath, v))  // removal must be done before adding the root
            let { referer } = ctx.headers
            referer &&= new URL(referer).pathname
            if (referer?.startsWith(ctx.state.revProxyPath + ADMIN_URI)) return // exclude apis for admin-panel
        }
        if (_.isEmpty(roots.get())) return
        const host2root = roots.compiled()
        if (!host2root) return
        const root = host2root(ctx.host)
        if (root === '' || root === '/') return
        if (root === undefined) {
            if (ctx.state.skipFilters || !rootsMandatory.get() || isLocalHost(ctx)) return
            disconnect(ctx, 'bad-domain')
            return true // true will avoid calling next
        }
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

function join(a: string, b: string, joiner='/') { // similar to path.join but OS independent
    if (!b) return a
    if (!a) return b
    const ends = a.at(-1) === joiner
    const starts = b[0] === joiner
    return a + (!ends && !starts ? joiner + b : ends && starts ? b.slice(1) : b)
}

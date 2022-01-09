import { createReadStream, watch } from 'fs'
import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import path from 'path'
import { PLUGINS_PUB_URI } from './const'
import mime from 'mime-types'
import Koa from 'koa'
import { WatchLoadCanceller } from './watchLoad'
import { getOrSet, wantArray } from './misc'

const PATH = 'plugins'

export const plugins: Record<string, Plugin> = {}

export function pluginsMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const { path } = ctx
        const after = []
        // run middleware plugins
        for (const pl of Object.values(plugins)) {
            const res = await pl.middleware?.(ctx)
            if (res === true)
                ctx.pluginStopped = true
            if (typeof res === 'function')
                after.push(res)
        }
        // expose public plugins' files
        if (path.startsWith(PLUGINS_PUB_URI)) {
            const a = path.substring(PLUGINS_PUB_URI.length).split('/')
            a.splice(1,0,'public')
            ctx.type = mime.lookup(path) || ''
            return ctx.body = createReadStream(PATH + '/' + a.join('/'))
        }
        if (!ctx.pluginStopped)
            await next()
        for (const f of after)
            await f()
    }
}

try {
    const debounced = _.debounce(rescan, 1000)
    watch(PATH, debounced)
    debounced()
}
catch(e){
    console.debug('plugins not found')
}

class Plugin {
    constructor(readonly k:string, private data:any, private unwatch:()=>void){
        plugins[k] = this // track this

        // some validation
        for (const k of ['frontend_css', 'frontend_js']) {
            const v = data[k]
            if (typeof v === 'string')
                data[k] = [v]
            else if (v && !Array.isArray(v)) {
                delete data[k]
                console.warn('invalid', k)
            }
        }
        let v = data.middleware
        if (v && !(v instanceof Function)) {
            delete data.middleware
            console.warn('invalid middleware')
        }
    }
    get middleware(): undefined | PluginMiddleware {
        return this.data.middleware
    }
    get frontend_css(): undefined | string[] {
        return this.data.frontend_css
    }
    get frontend_js(): undefined | string[] {
        return this.data.frontend_js
    }

    unload() {
        console.log('unloading plugin', this.k)
        delete plugins[this.k]
        this.unwatch()
    }
}

type PluginMiddleware = (ctx:Koa.Context) => void | Stop | CallMeAfter
type Stop = true
type CallMeAfter = ()=>void

async function rescan() {
    console.debug('scanning plugins')
    const found = []
    for (const f of await glob(PATH+'/*/plugin.yaml')) {
        const k = f.split('/').slice(-2)[0]
        if (k.endsWith('-disabled')) continue
        found.push(k)
        if (plugins[k]) // already loaded
            continue
        const unwatch = watchLoad(f, async data => {
            console.log('loading plugin', k)
            const importCanceller = await resolveImport(data, path.resolve(PATH)+'/'+k+'/')
            new Plugin(k, data, () => {
                unwatch()
                importCanceller()
            })
        })
    }
    for (const k in plugins)
        if (!found.includes(k))
            plugins[k].unload()
}

const re = /^ *import\((.+)\) *$/
async function resolveImport(x: Record<string,any>, basePath: string) {
    const cancellers: WatchLoadCanceller[] = []
    for (const k in x) {
        let v = x[k]
        if (!v)
            continue
        if (typeof v === 'object')
            await resolveImport(v, basePath)
        else if (typeof v === 'string' && re.test(v)) {
            const fn = re.exec(v)![1].replace(/\\/g, '//')
            if (fn.includes('..') || fn.startsWith('/') || fn.includes(':'))
                continue
            const path = basePath + fn
            await new Promise(resolve => // wait for first execution, so that the caller sees imported stuff instead of string
                cancellers.push(watchLoad(path, async () => {
                    try {
                        x[k] = (await import(path)).default
                        deleteModule(require.resolve(path)) // avoid caching
                        console.log('plugin imported', fn)
                    } catch (e) {
                        console.log('plugin error importing', fn, String(e))
                        delete x[k]
                    }
                    resolve(0)
                })) )
        }
    }
    return () => {
        for (const c of cancellers)
            c()
    }
}

function deleteModule(id: string) {
    const { cache } = require
    // build reversed map of dependencies
    const requiredBy: Record<string,string[]> = { '.':['.'] } // don't touch main entry
    for (const k in cache)
        if (k !== id)
            for (const child of wantArray(cache[k]?.children))
                getOrSet(requiredBy, child.id, ()=> [] as string[]).push(k)
    const deleted: string[] = []
    recur(id)

    function recur(id: string) {
        let mod = cache[id]
        if (!mod) return
        delete cache[id]
        deleted.push(id)
        for (const child of mod.children)
            if (! _.difference(requiredBy[child.id], deleted).length)
                recur(child.id)
    }
}

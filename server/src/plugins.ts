// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import { resolve } from 'path'
import { PLUGINS_PUB_URI } from './const'
import Koa from 'koa'
import { debounceAsync, getOrSet, onProcessExit, wantArray, watchDir } from './misc'
import { getConfig, subscribeConfig } from './config'
import { DirEntry } from './api.file_list'
import { VfsNode } from './vfs'
import { serveFile } from './serveFile'

const PATH = 'plugins'

const plugins: Record<string, Plugin> = {}

export function mapPlugins<T>(cb:(plugin:Readonly<Plugin>, pluginName:string)=> T) {
    return _.map(plugins, (pl,plName) => {
        try { return cb(pl,plName) }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }).filter(x => x !== undefined) as Exclude<T,undefined>[]
}

export function pluginsMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const after = []
        // run middleware plugins
        for (const k in plugins)
            try {
                const pl = plugins[k]
                const res = await pl.middleware?.(ctx)
                if (res === true)
                    ctx.pluginStopped = true
                if (typeof res === 'function')
                    after.push(res)
            }
            catch(e){
                console.log('error middleware plugin', k, String(e))
                console.debug(e)
            }
        // expose public plugins' files
        const { path } = ctx
        if (!ctx.pluginStopped) {
            if (path.startsWith(PLUGINS_PUB_URI)) {
                const a = path.substring(PLUGINS_PUB_URI.length).split('/')
                if (plugins.hasOwnProperty(a[0])) { // do it only if the plugin is loaded
                    a.splice(1, 0, 'public')
                    await serveFile(PATH + '/' + a.join('/'), 'auto')(ctx, next)
                }
            }
            await next()
        }
        for (const f of after)
            await f()
    }
}

subscribeConfig({ k:'disable_plugins', defaultValue:[] }, () => {
    try { watchDir(PATH, debounceAsync(rescan, 1000)) }
    catch {
        console.debug('plugins not found')
    }
})

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

class Plugin {
    js: any
    constructor(readonly k:string, private data:any, private unwatch:()=>void){
        if (!data) throw 'invalid data'
        // if a previous instance is present, we are going to overwrite it, but first call its unload callback
        try { plugins[k]?.data?.unload?.() }
        catch(e){
            console.debug('error unloading plugin', k, String(e))
        }
        plugins[k] = this // track this
        this.data = data = { ...data } // clone to make object modifiable. Objects coming from import are not.
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
    }
    get middleware(): undefined | PluginMiddleware {
        return this.data?.middleware
    }
    get frontend_css(): undefined | string[] {
        return this.data?.frontend_css
    }
    get frontend_js(): undefined | string[] {
        return this.data?.frontend_js
    }
    get onDirEntry(): undefined | OnDirEntry {
        return this.data?.onDirEntry
    }

    unload() {
        console.log('unloading plugin', this.k)
        try { this.data?.unload?.() }
        catch(e) {
            console.debug('error unloading plugin', this.k, String(e))
        }
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
    const disable_plugins = wantArray(getConfig('disable_plugins'))
    for (let f of await glob(PATH+'/*/plugin.js')) {
        const k = f.split('/').slice(-2)[0]
        if (k.endsWith('-disabled') || disable_plugins.includes(k)) continue
        found.push(k)
        if (plugins[k]) // already loaded
            continue
        f = resolve(f) // without this, import won't work
        const { unwatch } = watchLoad(f, async () => {
            try {
                console.log(plugins[k] ? 'reloading plugin' : 'loading plugin', k)
                const data = await import(f)
                deleteModule(require.resolve(f)) // avoid caching
                const res = await data.init?.call(null, {
                    srcDir: __dirname,
                    require,
                    getConfig: (cfgKey: string) =>
                        getConfig('plugins_config')?.[k]?.[cfgKey]
                })
                Object.assign(data, res)
                new Plugin(k, data, unwatch)
            } catch (e) {
                console.log('plugin error:', e)
            }
        })
    }
    for (const k in plugins)
        if (!found.includes(k))
            plugins[k].unload()
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

onProcessExit(sig => {
    for (const pl of Object.values(plugins))
        pl.unload()
    if (sig === 'SIGINT') // ctrl+c
        setTimeout(()=> process.exit(0))
})

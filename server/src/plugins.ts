// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import pathLib from 'path'
import { API_VERSION, COMPATIBLE_API_VERSION, PLUGINS_PUB_URI } from './const'
import * as Const from './const'
import Koa from 'koa'
import { debounceAsync, getOrSet, onProcessExit, wantArray, watchDir } from './misc'
import { defineConfig } from './config'
import { DirEntry } from './api.file_list'
import { VfsNode } from './vfs'
import { serveFile } from './serveFile'
import events from './events'
import { readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { getConnections } from './connections'

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

export function getPluginConfigFields(id: string) {
    return plugins[id]?.getData().config
}

export function pluginsMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const after = []
        // run middleware plugins
        for (const id in plugins)
            try {
                const pl = plugins[id]
                const res = await pl.middleware?.(ctx)
                if (res === true)
                    ctx.pluginStopped = true
                if (typeof res === 'function')
                    after.push(res)
            }
            catch(e){
                console.log('error middleware plugin', id, String(e))
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

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

export class Plugin {
    started = new Date()

    constructor(readonly id:string, private readonly data:any, private unwatch:()=>void){
        if (!data) throw 'invalid data'
        // if a previous instance is present, we are going to overwrite it, but first call its unload callback
        const old = plugins[id]
        try { old?.data?.unload?.() } // we don't want all the effects of the Plugin.unload
        catch(e){
            console.debug('error unloading plugin', id, String(e))
        }
        // track this
        const wasStopped = availablePlugins[id]
        if (wasStopped)
            delete availablePlugins[id]
        plugins[id] = this

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
        events.emit(old || wasStopped ? 'pluginStarted' : 'pluginInstalled', this)
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

    getData(): any {
        return { ...this.data }
    }

    async unload() {
        const { id } = this
        console.log('unloading plugin', id)
        try { await this.data?.unload?.() }
        catch(e) {
            console.debug('error unloading plugin', id, String(e))
        }
        delete plugins[id]
        this.unwatch()
        if (availablePlugins[id])
            events.emit('pluginStopped', availablePlugins[id])
        else
            events.emit('pluginUninstalled', id)
    }
}

type PluginMiddleware = (ctx:Koa.Context) => void | Stop | CallMeAfter
type Stop = true
type CallMeAfter = ()=>void

export interface AvailablePlugin { id: string, description?: string, version?: number, apiRequired?: number }
let availablePlugins: Record<string, AvailablePlugin> = {}

export function getAvailablePlugins() {
    return Object.values(availablePlugins)
}

const rescanAsap = debounceAsync(rescan, 1000)
if (!existsSync(PATH))
    try { mkdirSync(PATH) }
    catch {}
watchDir(PATH, rescanAsap)

export const enablePlugins = defineConfig('enable_plugins', ['antibrute'])
enablePlugins.sub(rescanAsap)

export const pluginsConfig = defineConfig('plugins_config', {} as Record<string,any>)

async function rescan() {
    console.debug('scanning plugins')
    const found = []
    const foundDisabled: typeof availablePlugins = {}
    for (let f of await glob(PATH+'/*/plugin.js')) {
        const id = f.split('/').slice(-2)[0]
        if (id.endsWith('-disabled')) continue
        if (!enablePlugins.get().includes(id)) {
            const pl = foundDisabled[id] = { id } as typeof foundDisabled[0]
            try {
                const source = await readFile(f, 'utf8')
                const v = pl.description = /exports.description *= *"(.*)"/.exec(source)?.[1]
                if (v)
                    try { pl.description = JSON.parse(`"${v}"`) }
                    catch {}
                pl.version = Number(/exports.version *= *(\d+)/.exec(source)?.[1]) || undefined
                pl.apiRequired = Number(/exports.apiRequired *= *(\d+)/.exec(source)?.[1]) || undefined
            }
            catch {}
            continue
        }
        found.push(id)
        if (plugins[id]) // already loaded
            continue
        const module = pathLib.resolve(f)
        const { unwatch } = watchLoad(f, async () => {
            try {
                console.log(plugins[id] ? 'reloading plugin' : 'loading plugin', id)
                const { init, ...data } = await import(module)
                delete data.default
                deleteModule(require.resolve(module)) // avoid caching at next import
                if (data.apiRequired > API_VERSION)
                    console.log('plugin', id, 'may not work correctly as it is designed for a newer version of HFS')
                if (data.apiRequired < COMPATIBLE_API_VERSION)
                    console.log('plugin', id, 'may not work correctly as it is designed for an older version of HFS')
                const res = await init?.call(null, {
                    srcDir: __dirname,
                    const: Const,
                    require,
                    getConnections,
                    events,
                    getConfig: (cfgKey: string) =>
                        pluginsConfig.get()?.[id]?.[cfgKey] ?? data.config?.[cfgKey]?.defaultValue
                })
                Object.assign(data, res)
                new Plugin(id, data, unwatch)
            } catch (e) {
                console.log('plugin error:', e)
            }
        })
    }
    for (const id in foundDisabled)
        if (!availablePlugins[id]) {
            availablePlugins[id] = foundDisabled[id]
            if (!plugins[id])
                events.emit('pluginInstalled', foundDisabled[id])
        }
    for (const id in availablePlugins)
        if (!foundDisabled[id] && !found.includes(id) && !plugins[id]) {
            delete availablePlugins[id]
            events.emit('pluginUninstalled', id)
        }
    for (const id in plugins)
        if (!found.includes(id))
            await plugins[id].unload()
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

onProcessExit(() =>
    Promise.allSettled(mapPlugins(pl => pl.unload())))

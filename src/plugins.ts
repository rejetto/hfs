// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import { API_VERSION, APP_PATH, COMPATIBLE_API_VERSION, IS_WINDOWS, PLUGINS_PUB_URI } from './const'
import * as Const from './const'
import Koa from 'koa'
import {
    adjustStaticPathForGlob,
    Callback,
    debounceAsync,
    Dict,
    getOrSet,
    onProcessExit,
    PendingPromise, pendingPromise,
    same,
    tryJson,
    wait,
    wantArray,
    watchDir
} from './misc'
import { defineConfig, getConfig } from './config'
import { DirEntry } from './api.file_list'
import { VfsNode } from './vfs'
import { serveFile } from './serveFile'
import events from './events'
import { mkdir, readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { getConnections } from './connections'
import { dirname, join, resolve } from 'path'
import { newCustomHtmlState, watchLoadCustomHtml } from './customHtml'

export const PATH = 'plugins'
export const DISABLING_POSTFIX = '-disabled'
export const STORAGE_FOLDER = 'storage'

const plugins: Record<string, Plugin> = {}

export function isPluginRunning(id: string) {
    return Boolean(plugins[id]?.started)
}

export function isPluginEnabled(id: string) {
    return enablePlugins.get().includes(id)
}

export function enablePlugin(id: string, state=true) {
    if (state && !getPluginInfo(id))
        throw Error('miss')
    console.log("switching plugin", id, state ? "on" : "off")
    enablePlugins.set( arr =>
        arr.includes(id) === state ? arr
            : state ? [...arr, id]
                : arr.filter((x: string) => x !== id)
    )
}

export async function stopPlugin(id: string) {
    enablePlugin(id, false)
    await waitRunning(id, false)
}

export async function startPlugin(id: string) {
    enablePlugin(id)
    await waitRunning(id)
}

async function waitRunning(id: string, state=true) {
    while (isPluginRunning(id) !== state) {
        await wait(500)
        const error = getError(id)
        if (error)
            throw Error(error)
    }
}

// nullish values are equivalent to defaultValues
export function setPluginConfig(id: string, changes: Dict) {
    pluginsConfig.set(allConfigs => {
        const fields = getPluginConfigFields(id)
        const oldConfig = allConfigs[id]
        const newConfig = _.pickBy({ ...oldConfig, ...changes },
            (v, k) => v != null && !same(v, fields?.[k]?.defaultValue))
        return { ...allConfigs, [id]: _.isEmpty(newConfig) ? undefined : newConfig }
    })
}

export function getPluginInfo(id: string) {
    const running = plugins[id]?.getData()
    return running && Object.assign(running, {id}) || availablePlugins[id]
}

export function mapPlugins<T>(cb:(plugin:Readonly<Plugin>, pluginName:string)=> T) {
    return _.map(plugins, (pl,plName) => {
        try { return cb(pl,plName) }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }).filter(x => x !== undefined) as Exclude<T,undefined>[]
}

export function findPluginByRepo<T>(repo: string) {
    return _.find(plugins, pl => pl.getData()?.repo === repo)
        || _.find(availablePlugins, { repo })
}

export function getPluginConfigFields(id: string) {
    return plugins[id]?.getData().config
}

export function pluginsMiddleware(): Koa.Middleware {
    return async (ctx, next) => {
        const after: Dict<CallMeAfter> = {}
        // run middleware plugins
        for (const [id,pl] of Object.entries(plugins))
            try {
                const res = await pl.middleware?.(ctx)
                if (res === true)
                    ctx.pluginStopped = true
                if (typeof res === 'function')
                    after[id] = res
            }
            catch(e){
                printError(id, e)
            }
        // expose public plugins' files
        const { path } = ctx
        if (!ctx.pluginStopped) {
            if (path.startsWith(PLUGINS_PUB_URI)) {
                const a = path.substring(PLUGINS_PUB_URI.length).split('/')
                const name = a.shift()!
                if (plugins.hasOwnProperty(name)) // do it only if the plugin is loaded
                    await serveFile(ctx, plugins[name]!.folder + '/public/' + a.join('/'), 'auto')
                return
            }
            await next()
        }
        for (const [id,f] of Object.entries(after))
            try { await f() }
            catch (e) { printError(id, e) }
    }

    function printError(id: string, e: any) {
        console.log(`error middleware plugin ${id}: ${e?.message || e}`)
        console.debug(e)
    }
}

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

export class Plugin {
    started: Date | null = new Date()

    constructor(readonly id:string, readonly folder:string, private readonly data:any, private unwatch:()=>void){
        if (!data) throw 'invalid data'

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
    get version(): undefined | number {
        return this.data?.version
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

    async unload(reloading=false) {
        if (!this.started) return
        this.started = null
        const { id } = this
        try {
            await this.data?.unload?.()
            if (!reloading) // we already printed 'reloading'
                console.log('unloaded plugin', id)
        }
        catch(e) {
            console.log('error unloading plugin', id, String(e))
        }
        if (this.data)
            this.data.unload = undefined
        this.unwatch()
    }
}

type PluginMiddleware = (ctx:Koa.Context) => void | Stop | CallMeAfter
type Stop = true
type CallMeAfter = ()=>any

export interface AvailablePlugin {
    id: string
    description?: string
    version?: number
    apiRequired?: number | [number,number]
    repo?: string
    depend?: { repo: string, version?: number }[]
    branch?: string
    badApi?: string
    error?: string
}

let availablePlugins: Record<string, AvailablePlugin> = {}

export function getAvailablePlugins() {
    return Object.values(availablePlugins)
}

const rescanAsap = debounceAsync(rescan, 1000)
if (!existsSync(PATH))
    try { mkdirSync(PATH) }
    catch {}
export const pluginsWatcher = watchDir(PATH, rescanAsap)

export const enablePlugins = defineConfig('enable_plugins', ['antibrute'])
enablePlugins.sub(rescanAsap)

export const pluginsConfig = defineConfig('plugins_config', {} as Record<string,any>)

const pluginWatchers = new Map<string, ReturnType<typeof watchPlugin>>()

export async function rescan() {
    console.debug('scanning plugins')
    const patterns = [PATH + '/*']
    if (APP_PATH !== process.cwd())
        patterns.push(adjustStaticPathForGlob(APP_PATH) + '/' + patterns[0])
    const met = []
    for (const { path, dirent } of await glob(patterns, { onlyFiles: false, suppressErrors: true, objectMode: true })) {
        if (!dirent.isDirectory() || path.endsWith(DISABLING_POSTFIX)) continue
        const id = path.split('/').slice(-1)[0]!
        met.push(id)
        const w = pluginWatchers.get(id)
        if (w) continue
        console.debug('plugin watch', id)
        pluginWatchers.set(id, watchPlugin(id, join(path, 'plugin.js')))
    }
    for (const [id, cancelWatcher] of pluginWatchers.entries())
        if (!met.includes(id)) {
            enablePlugin(id, false)
            console.debug('plugin unwatch', id)
            cancelWatcher()
            pluginWatchers.delete(id)
        }
}

function watchPlugin(id: string, path: string) {
    const module = resolve(path)
    let starting: PendingPromise | undefined
    enablePlugins.sub(() => { // we take care of enabled-state after it was loaded
        if (!getPluginInfo(id)) return // not loaded yet
        const enabled = isPluginEnabled(id)
        if (enabled !== isPluginRunning(id))
            return enabled ? start() : stop()
    })
    const { unwatch } = watchLoad(module, async (source) => {
        const notRunning = availablePlugins[id]
        if (!source) {
            await stop()
            delete availablePlugins[id]
            events.emit('pluginUninstalled', id)
            return
        }
        if (isPluginEnabled(id))
            return start()
        const p = parsePluginSource(id, source)
        if (same(notRunning, p)) return
        availablePlugins[id] = p
        events.emit(notRunning ? 'pluginUpdated' : 'pluginInstalled', p)
    })
    return unwatch

    async function markItAvailable() {
        delete plugins[id]
        const source = await readFile(module, 'utf8')
        availablePlugins[id] = parsePluginSource(id, source)
    }

    async function stop() {
        await starting
        const p = plugins[id]
        if (!p) return
        await p.unload()
        await markItAvailable()
        events.emit('pluginStopped', p)
    }

    async function start() {
        if (starting) return
        try {
            starting = pendingPromise()
            if (getPluginInfo(id))
                setError(id, '')
            const alreadyRunning = plugins[id]
            console.log(alreadyRunning ? "reloading plugin" : "loading plugin", id)
            const { init, ...data } = await import(module)
            delete data.default
            deleteModule(require.resolve(module)) // avoid caching at next import
            calculateBadApi(data)
            if (data.badApi)
                console.log("plugin", id, data.badApi)

            await alreadyRunning?.unload(true)
            console.debug("starting plugin", id)
            const storageDir = resolve(module, '..', STORAGE_FOLDER) + (IS_WINDOWS ? '\\' : '/')
            await mkdir(storageDir, { recursive: true })
            const res = await init?.call(null, {
                srcDir: __dirname,
                storageDir,
                const: Const,
                require,
                getConnections,
                events,
                log(...args: any[]) {
                    console.log('plugin', id+':', ...args)
                },
                getConfig: (cfgKey: string) =>
                    pluginsConfig.get()?.[id]?.[cfgKey] ?? data.config?.[cfgKey]?.defaultValue,
                setConfig: (cfgKey: string, value: any) =>
                    setPluginConfig(id, { [cfgKey]: value }),
                subscribeConfig(cfgKey: string, cb: Callback<any>) {
                    let last = this.getConfig(cfgKey)
                    cb(last)
                    return pluginsConfig.sub(() => {
                        const now = this.getConfig(cfgKey)
                        if (same(now, last)) return
                        try { cb(last = now) }
                        catch(e){
                            console.log('plugin', id, String(e))
                        }
                    })
                },
                getHfsConfig: getConfig,
                customApiCall(method: string, params?: any) {
                    return mapPlugins(pl => pl.getData().customApi?.[method]?.(params))
                }
            })
            const folder = dirname(module)
            Object.assign(data, res, {
                customHtml: newCustomHtmlState()
            })
            const customHtmlWatcher = watchLoadCustomHtml(data.customHtml, folder)
            const plugin = plugins[id] = new Plugin(id, folder, data, customHtmlWatcher.unwatch)
            if (alreadyRunning)
                events.emit('pluginUpdated', Object.assign(_.pick(plugin, 'started'), getPluginInfo(id)))
            else {
                const wasInstalled = availablePlugins[id]
                if (wasInstalled)
                    delete availablePlugins[id]
                events.emit(wasInstalled ? 'pluginStarted' : 'pluginInstalled', plugin)
            }

        } catch (e: any) {
            await markItAvailable()
            e = e.message || String(e)
            console.log(`plugin error: ${id}:`, e)
            setError(id, e)
        }
        finally {
            starting?.resolve()
            starting = undefined
        }

    }
}

function getError(id: string) {
    return getPluginInfo(id).error
}

function setError(id: string, error: string) {
    getPluginInfo(id).error = error
    events.emit('pluginUpdated', { id, error })
}

function deleteModule(id: string) {
    const { cache } = require
    if (!cache) // bun 0.6.2 doesn't have it
        return console.warn("plugin may be not reloaded correctly")
    // build reversed map of dependencies
    const requiredBy: Record<string,string[]> = { '.':['.'] } // don't touch main entry
    for (const k in cache)
        if (k !== id)
            for (const child of wantArray(cache[k]?.children))
                getOrSet(requiredBy, child.id, ()=> [] as string[]).push(k)
    const deleted: string[] = []
    ;(function deleteCache(id: string) {
        const mod = cache[id]
        if (!mod) return
        delete cache[id]
        deleted.push(id)
        for (const child of mod.children)
            if (! _.difference(requiredBy[child.id], deleted).length)
                deleteCache(child.id)
    })(id)
}

onProcessExit(() =>
    Promise.allSettled(mapPlugins(pl => pl.unload())))

export function parsePluginSource(id: string, source: string) {
    const pl: AvailablePlugin = { id }
    pl.description = tryJson(/exports.description *= *(".*")/.exec(source)?.[1])
    pl.repo = /exports.repo *= *"(.*)"/.exec(source)?.[1]
    pl.version = Number(/exports.version *= *(\d*\.?\d+)/.exec(source)?.[1]) ?? undefined
    pl.apiRequired = tryJson(/exports.apiRequired *= *([ \d.,[\]]+)/.exec(source)?.[1]) ?? undefined
    pl.depend = tryJson(/exports.depend *= *(\[.*\])/m.exec(source)?.[1])?.filter((x: any) =>
        typeof x.repo === 'string' && x.version === undefined || typeof x.version === 'number'
            || console.warn("plugin dependency discarded", x) )
    if (Array.isArray(pl.apiRequired) && (pl.apiRequired.length !== 2 || !pl.apiRequired.every(_.isFinite))) // validate [from,to] form
        pl.apiRequired = undefined
    calculateBadApi(pl)
    return pl
}

function calculateBadApi(data: AvailablePlugin) {
    const r = data.apiRequired
    const [min, max] = Array.isArray(r) ? r : [r, r] // normalize data type
    data.badApi = min! > API_VERSION ? "may not work correctly as it is designed for a newer version of HFS - check for updates"
        : max! < COMPATIBLE_API_VERSION ? "may not work correctly as it is designed for an older version of HFS - check for updates"
            : undefined
}

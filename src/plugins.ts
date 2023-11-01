// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import { API_VERSION, APP_PATH, COMPATIBLE_API_VERSION, IS_WINDOWS, PLUGINS_PUB_URI } from './const'
import * as Const from './const'
import Koa from 'koa'
import {
    adjustStaticPathForGlob, Callback, debounceAsync, Dict, getOrSet, onlyTruthy, onProcessExit,
    PendingPromise, pendingPromise, same, tryJson, wait, waitFor, wantArray, watchDir
} from './misc'
import { defineConfig, getConfig } from './config'
import { DirEntry } from './api.file_list'
import { MIME_AUTO, VfsNode } from './vfs'
import { serveFile } from './serveFile'
import events from './events'
import { mkdir, readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { getConnections } from './connections'
import { dirname, join, resolve } from 'path'
import { watchLoadCustomHtml } from './customHtml'

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
    enablePlugins.set(arr => {
        if (arr.includes(id) === state)
            return arr
        console.log("switching plugin", id, state ? "on" : "off")
        return arr.includes(id) === state ? arr
            : state ? [...arr, id]
                : arr.filter((x: string) => x !== id)
    })
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

export function findPluginByRepo<T>(repo: string) {
    return _.find(plugins, pl => match(pl.getData()))
        || _.find(availablePlugins, match)

    function match(rec: any) {
        return repo === (rec?.repo?.main ?? rec?.repo)
    }
}

export function getPluginConfigFields(id: string) {
    return plugins[id]?.getData().config
}

async function initPlugin<T>(pl: any, more?: T) {
    return Object.assign(pl, await pl.init?.({
        Const,
        require,
        getConnections,
        events,
        log: console.log,
        getHfsConfig: getConfig,
        customApiCall,
        ...more
    }))
}

export const pluginsMiddleware: Koa.Middleware = async (ctx, next) => {
    const after: Dict<CallMeAfter> = {}
    // run middleware plugins
    await Promise.all(mapPlugins(async (pl, id) => {
        try {
            const res = await pl.middleware?.(ctx)
            if (res === true)
                console.debug("plugin blocked request", ctx.pluginBlockedRequest = id)
            if (typeof res === 'function')
                after[id] = res
        }
        catch(e){
            printError(id, e)
        }
    }))
    // expose public plugins' files`
    if (!ctx.pluginBlockedRequest) {
        const { path } = ctx
        if (path.startsWith(PLUGINS_PUB_URI)) {
            const a = path.substring(PLUGINS_PUB_URI.length).split('/')
            const name = a.shift()!
            if (plugins.hasOwnProperty(name)) // do it only if the plugin is loaded
                await serveFile(ctx, plugins[name]!.folder + '/public/' + a.join('/'), MIME_AUTO)
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

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

export class Plugin implements CommonPluginInterface {
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
        plugins[id] = this
    }
    get version(): undefined | number { return this.data?.version }
    get description(): undefined | string { return this.data?.description }
    get apiRequired(): undefined | number | [number,number] { return this.data?.apiRequired }
    get repo(): undefined | Repo { return this.data?.repo }
    get depend(): undefined | Depend { return this.data?.depend }

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
            if (!reloading && id !== SERVER_CODE_ID) // we already printed 'reloading'
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

const SERVER_CODE_ID = '.'
const serverCode = defineConfig('server_code', '', async (script, { k }) => {
    const res: any = {}
    try {
        new Function('exports', script)(res) // parse
        return new Plugin(SERVER_CODE_ID, '', await initPlugin(res), _.noop) // '.' is a name that will surely be not found among plugin folders
    }
    catch (e: any) {
        return console.error(k + ':', e.message || String(e))
    }
})

let serverCodePlugin: void | Plugin
serverCode.sub(() => serverCode.compiled()?.then(x => serverCodePlugin = x))
export function mapPlugins<T>(cb:(plugin:Readonly<Plugin>, pluginName:string)=> T, includeServerCode=true) {
    const entries = Object.entries(plugins)
    return entries.map(([plName,pl]) => {
        if (!includeServerCode && plName === SERVER_CODE_ID) return
        try { return cb(pl,plName) }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }).filter(x => x !== undefined) as Exclude<T,undefined>[]
}

type PluginMiddleware = (ctx:Koa.Context) => void | Stop | CallMeAfter
type Stop = true
type CallMeAfter = ()=>any

export type Repo = string | { web?: string, main: string, zip?: string, zipRoot?: string }
type Depend = { repo: string, version?: number }[]
export interface CommonPluginInterface {
    id: string
    description?: string
    version?: number
    apiRequired?: number | [number,number]
    repo?: Repo
    depend?: Depend
}
export interface AvailablePlugin extends CommonPluginInterface {
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
        if (!source)
            return onUninstalled()
        if (isPluginEnabled(id))
            return start()
        const p = parsePluginSource(id, source)
        if (same(notRunning, p)) return
        availablePlugins[id] = p
        events.emit(notRunning ? 'pluginUpdated' : 'pluginInstalled', p)
    })
    return () => {
        unwatch()
        return onUninstalled()
    }

    async function onUninstalled() {
        await stop()
        delete availablePlugins[id]
        events.emit('pluginUninstalled', id)
    }

    async function markItAvailable() {
        delete plugins[id]
        availablePlugins[id] = await parsePlugin()
    }

    async function parsePlugin() {
        return parsePluginSource(id, await readFile(module, 'utf8'))
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
            // if dependencies are not ready right now, we give some time. Not super-solid but good enough for now.
            const info = await parsePlugin()
            if (!await waitFor(async () => _.isEmpty(await getMissingDependencies(info)), { timeout: 5_000 }))
                return console.debug("plugin missing dependencies", id)
            if (getPluginInfo(id))
                setError(id, '')
            const alreadyRunning = plugins[id]
            console.log(alreadyRunning ? "reloading plugin" : "loading plugin", id)
            const pluginData = await import(module)
            deleteModule(require.resolve(module)) // avoid caching at next import
            calculateBadApi(pluginData)
            if (pluginData.badApi)
                console.log("plugin", id, pluginData.badApi)

            await alreadyRunning?.unload(true)
            console.debug("starting plugin", id)
            const storageDir = resolve(module, '..', STORAGE_FOLDER) + (IS_WINDOWS ? '\\' : '/')
            await mkdir(storageDir, { recursive: true })
            await initPlugin(pluginData, {
                srcDir: __dirname,
                storageDir,
                log(...args: any[]) {
                    console.log('plugin', id+':', ...args)
                },
                getConfig: (cfgKey: string) =>
                    pluginsConfig.get()?.[id]?.[cfgKey] ?? pluginData.config?.[cfgKey]?.defaultValue,
                setConfig: (cfgKey: string, value: any) =>
                    setPluginConfig(id, { [cfgKey]: value }),
                subscribeConfig(cfgKey: string, cb: Callback<any>) {
                    let last = this.getConfig(cfgKey)
                    cb(last)
                    return pluginsConfig.sub(() => {
                        const now = this.getConfig(cfgKey)
                        if (same(now, last)) return
                        try { cb(last = now) }
                        catch(e){ this.log(String(e)) }
                    })
                },
            })
            const folder = dirname(module)
            const { state, unwatch } = watchLoadCustomHtml(folder)
            pluginData.customHtml = state
            const plugin = new Plugin(id, folder, pluginData, unwatch)
            if (alreadyRunning)
                events.emit('pluginUpdated', Object.assign(_.pick(plugin, 'started'), getPluginInfo(id)))
            else {
                const wasInstalled = availablePlugins[id]
                if (wasInstalled)
                    delete availablePlugins[id]
                events.emit(wasInstalled ? 'pluginStarted' : 'pluginInstalled', plugin)
            }
            events.emit('pluginStarted:'+id)
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

function customApiCall(method: string, ...params: any[]) {
    return mapPlugins(pl => pl.getData().customApi?.[method]?.(...params))
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
    pl.repo = tryJson(/exports.repo *= *(.*);? *$/m.exec(source)?.[1])
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

export async function getMissingDependencies(plugin: CommonPluginInterface) {
    return onlyTruthy((plugin?.depend || []).map((dep: any) => {
        const res = findPluginByRepo(dep.repo)
        const error = !res ? 'missing'
            : (res.version || 0) < dep.version ? 'version'
                : !isPluginEnabled(res.id) ? 'disabled'
                    : !isPluginRunning(res.id) ? 'stopped'
                        : ''
        return error && { repo: dep.repo, error, id: res?.id }
    }))
}
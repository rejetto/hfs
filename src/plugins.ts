// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import glob from 'fast-glob'
import { watchLoad } from './watchLoad'
import _ from 'lodash'
import {
    API_VERSION, APP_PATH, COMPATIBLE_API_VERSION, HTTP_NOT_FOUND, IS_WINDOWS, MIME_AUTO, PLUGINS_PUB_URI
} from './const'
import * as Const from './const'
import Koa from 'koa'
import {
    adjustStaticPathForGlob, callable, Callback, CFG, debounceAsync, Dict, objSameKeys, onlyTruthy, prefix,
    PendingPromise, pendingPromise, Promisable, same, tryJson, wait, waitFor, wantArray, watchDir, objFromKeys, patchKey
} from './misc'
import * as misc from './misc'
import { defineConfig, getConfig } from './config'
import { DirEntry } from './api.get_file_list'
import { VfsNode } from './vfs'
import { serveFile } from './serveFile'
import events from './events'
import { mkdir, readdir, readFile, rename, rm } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { getConnections } from './connections'
import { dirname, join, resolve } from 'path'
import { watchLoadCustomHtml } from './customHtml'
import { KvStorage, KvStorageOptions } from '@rejetto/kvstorage'
import { onProcessExit } from './first'
import { notifyClient } from './frontEndApis'
import { app } from './index'
import { addBlock } from './block'
import { getLangData } from './lang'
import { i18nFromTranslations } from './i18n'
import { addAccount, ctxBelongsTo, delAccount, getAccount, getUsernames, renameAccount, updateAccount } from './perm'
import { getCurrentUsername } from './auth'
import { CustomizedIcons, watchIconsFolder } from './icons'
import { getServerStatus } from './listen'

export const PATH = 'plugins'
export const DISABLING_SUFFIX = '-disabled'
export const DELETE_ME_SUFFIX = '-delete_me' + DISABLING_SUFFIX
export const STORAGE_FOLDER = 'storage'

setTimeout(async () => { // delete leftovers, if any
    for (const x of await readdir(PATH))
        if (x.endsWith(DELETE_ME_SUFFIX))
            await rm(join(PATH, x), { recursive: true, force: true }).catch(() => {})
}, 1000)

const plugins = new Map<string, Plugin>() // now that we care about the order, a simple object wouldn't do, because numbers are always at the beginning

export function isPluginRunning(id: string) {
    return Boolean(plugins.get(id)?.started)
}

export function isPluginEnabled(id: string, considerSuspension=false) {
    return (!considerSuspension || !suspendPlugins.get()) && enablePlugins.get().includes(id)
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
    if (getPluginInfo(id)?.isTheme)
        await Promise.all(mapPlugins((pl, id) => pl.isTheme && stopPlugin(id)))
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
export function setPluginConfig(id: string, changes: Dict | null) {
    pluginsConfig.set(allConfigs => {
        const fields = getPluginConfigFields(id)
        const oldConfig = allConfigs[id]
        const newConfig = changes && _.pickBy({ ...oldConfig, ...changes },
            (v, k) => v != null && !same(v, fields?.[k]?.defaultValue))
        return { ...allConfigs, [id]: _.isEmpty(newConfig) ? undefined : newConfig }
    })
}

export function getPluginInfo(id: string) {
    const running = plugins.get(id)
    return running && { ...running.getData(), ...running } || availablePlugins[id]
}

export function findPluginByRepo<T>(repo: string) {
    for (const pl of plugins.values())
        if (match(pl.getData()))
            return pl
    return _.find(availablePlugins, match)

    function match(rec: any) {
        return repo === (rec?.repo?.main ?? rec?.repo)
    }
}

export function getPluginConfigFields(id: string) {
    return plugins.get(id)?.getData().config
}

async function initPlugin(pl: any, morePassedToInit?: { id: string } & Dict<any>) {
    const undoEvents: any[] = []
    const timeouts: NodeJS.Timeout[] = []
    const controlledEvents = Object.create(events, objFromKeys(['on', 'once', 'multi'], k => ({
        value() {
            const ret = (events[k] as any)(...arguments)
            undoEvents.push(ret)
            return ret
        }
    })))
    const res = await pl.init?.({
        Const, require,
        // intercept all subscriptions, so to be able to undo them on unload
        events: controlledEvents,
        log: console.log,
        setError(msg: string) { setError(morePassedToInit?.id || 'server_code', msg) },
        getHfsConfig: getConfig,
        setInterval() { // @ts-ignore
            const ret = setInterval(...arguments)
            timeouts.push(ret) // intervals can be canceled by clearTimeout (source: MDN)
            return ret
        },
        setTimeout() { // @ts-ignore
            const ret = setTimeout(...arguments)
            timeouts.push(ret)
            return ret
        },
        async onServer(cb: Callback<object>) {
            const res = await getServerStatus()
            if (res.http.srv)
                cb(res.http.srv)
            if (res.https.srv)
                cb(res.https.srv)
            controlledEvents.on('listening', ({ server }: any) => cb(server))
        },
        misc, _,
        customApiCall, notifyClient, addBlock, ctxBelongsTo, getConnections,
        getCurrentUsername, getAccount, getUsernames, addAccount, delAccount, updateAccount, renameAccount,
        ...morePassedToInit
    })
    Object.assign(pl, typeof res === 'function' ? { unload: res } : res)
    patchKey(pl, 'unload', was => () => {
        for (const x of timeouts) clearTimeout(x)
        for (const cb of undoEvents) cb()
        if (typeof was === 'function')
            return was(...arguments)
    })
    events.emit('pluginInitialized', pl)
    return pl
}

const already = new Set()
function warnOnce(msg: string) {
    if (already.has(msg)) return
    already.add(msg)
    console.log('Warning: ' + msg)
}

export const pluginsMiddleware: Koa.Middleware = async (ctx, next) => {
    const after: Dict<CallMeAfter> = {}
    // run middleware plugins
    let lastStatus = ctx.status
    let lastBody = ctx.body
    await Promise.all(mapPlugins(async (pl, id) => {
        try {
            const res = await pl.middleware?.(ctx)
            if (lastStatus !== ctx.status || lastBody !== ctx.body) {
                console.debug("plugin changed response", id)
                lastStatus = ctx.status
                lastBody = ctx.body
            }
            if (res === true && !ctx.isStopped) { //legacy pre-0.53
                ctx.stop()
                warnOnce(`plugin ${id} is using deprecated API (return true on middleware) and may not work with future versions (check for an update to "${id}")`)
            }
            // don't just check ctx.isStopped, as the async plugin that called ctx.stop will reach here after sync ones
            if (ctx.isStopped && !ctx.pluginBlockedRequest)
                console.debug("plugin blocked request", ctx.pluginBlockedRequest = id)
            if (typeof res === 'function')
                after[id] = res
        }
        catch(e){
            printError(id, e)
        }
    }))
    // expose public plugins' files`
    if (!ctx.isStopped) {
        const { path } = ctx
        if (path.startsWith(PLUGINS_PUB_URI)) {
            const a = path.substring(PLUGINS_PUB_URI.length).split('/')
            const name = a.shift()!
            if (plugins.has(name)) { // do it only if the plugin is loaded
                if (ctx.get('referer')?.endsWith('/'))
                    ctx.state.considerAsGui = true
                await serveFile(ctx, plugins.get(name)!.folder + '/public/' + a.join('/'), MIME_AUTO)
            }
            return
        }
        if (ctx.body === undefined && ctx.status === HTTP_NOT_FOUND) // no response was provided by plugins, so we'll do
            await next()
    }
    for (const [id,f] of Object.entries(after))
        try { await f() }
        catch (e) { printError(id, e) }

    function printError(id: string, e: any) {
        console.log(`error middleware plugin ${id}: ${e?.message || e}`)
        console.debug(e)
    }
}

declare module "koa" {
    interface BaseContext {
        stop(): void
    }
}
events.once('app', () => Object.assign(app.context, {
    isStopped: false,
    stop() { return this.isStopped = true }
}))

// return false to ask to exclude this entry from results
interface OnDirEntryParams { entry:DirEntry, ctx:Koa.Context, node:VfsNode }
type OnDirEntry = (params:OnDirEntryParams) => void | false

export class Plugin implements CommonPluginInterface {
    started: Date | null = new Date()
    icons: CustomizedIcons
    log: { ts: Date, msg: string }[]

    constructor(readonly id:string, readonly folder:string, private readonly data:any, private onUnload:()=>unknown){
        if (!data) throw 'invalid data'

        this.log = []
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
        plugins.set(id, this)

        const keys = Array.from(plugins.keys())
        const idx = keys.indexOf(id)
        const moveDown = onlyTruthy(mapPlugins(((pl, plId, plIdx) => pl.afterPlugin === id && plIdx < idx && plId)))
        const {beforePlugin, afterPlugin} = data // or this plugin that wants to be considered before another
        if (afterPlugin &&  keys.indexOf(afterPlugin) > idx)
            moveDown.push(id)
        if (beforePlugin && keys.indexOf(beforePlugin) < idx)
            moveDown.push(beforePlugin)
        for (const k of moveDown) {
            const temp = plugins.get(k)
            if (!temp) continue
            plugins.delete(k)
            plugins.set(k, temp)
        }
    }
    get version(): undefined | number { return this.data?.version }
    get description(): undefined | string { return this.data?.description }
    get apiRequired(): undefined | number | [number,number] { return this.data?.apiRequired }
    get isTheme(): undefined | boolean { return this.data?.isTheme }
    get repo(): undefined | Repo { return this.data?.repo }
    get depend(): undefined | Depend { return this.data?.depend }
    get afterPlugin(): undefined | string { return this.data?.afterPlugin }
    get beforePlugin(): undefined | string { return this.data?.beforePlugin }

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
        return this.data
    }

    async unload(reloading=false) {
        if (!this.started) return
        this.started = null
        const { id } = this
        try { await this.data?.unload?.() }
        catch(e) {
            console.log('error unloading plugin', id, String(e))
        }
        await this.onUnload()
        if (!reloading && id !== SERVER_CODE_ID) // we already printed 'reloading'
            console.log('unloaded plugin', id)
        if (this.data)
            this.data.unload = undefined
    }
}

export const SERVER_CODE_ID = '.' // a name that will surely be not found among plugin folders
const serverCode = defineConfig('server_code', '', async (script, { k }) => {
    try { (await serverCode.compiled())?.unload() }
    catch {}
    const res: any = {}
    try {
        new Function('exports', script)(res) // parse
        await initPlugin(res)
        res.getCustomHtml = () => callable(res.customHtml) || {}
        return new Plugin(SERVER_CODE_ID, '', res, _.noop)
    }
    catch (e: any) {
        return console.error(k + ':', e.message || String(e))
    }
})

export function mapPlugins<T>(cb:(plugin:Readonly<Plugin>, pluginName:string, idx:number)=> T, includeServerCode=true) {
    let i = 0
    return Array.from(plugins).map(([plName,pl]) => {
        if (!includeServerCode && plName === SERVER_CODE_ID) return
        try { return cb(pl,plName,i++) }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }).filter(x => x !== undefined) as Exclude<T,undefined>[]
}

export function firstPlugin<T>(cb:(plugin:Readonly<Plugin>, pluginName:string)=> T, includeServerCode=true) {
    for (const [plName, pl] of plugins.entries()) {
        if (!includeServerCode && plName === SERVER_CODE_ID) continue
        try {
            const ret = cb(pl,plName)
            if (ret !== undefined)
                return ret
        }
        catch(e) {
            console.log('plugin error', plName, String(e))
        }
    }
}

type PluginMiddleware = (ctx:Koa.Context) => Promisable<void | Stop | CallMeAfter>
type Stop = true
type CallMeAfter = ()=>any

export type Repo = string | { web?: string, main: string, zip?: string, zipRoot?: string } // string is github, object is custom
type Depend = { repo: string, version?: number }[]
export interface CommonPluginInterface {
    id: string
    description?: string
    version?: number
    apiRequired?: number | [number,number]
    repo?: Repo
    depend?: Depend
    isTheme?: boolean | 'light' | 'dark'
    preview?: string | string[]
    changelog?: unknown
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

const rescanAsap = debounceAsync(rescan, { wait: 1000 })
if (!existsSync(PATH))
    try { mkdirSync(PATH) }
    catch {}
export const pluginsWatcher = watchDir(PATH, rescanAsap)

export const enablePlugins = defineConfig('enable_plugins', ['antibrute'])
enablePlugins.sub(rescanAsap)

export const suspendPlugins = defineConfig(CFG.suspend_plugins, false)

export const pluginsConfig = defineConfig('plugins_config', {} as Record<string,any>)
export const PLUGIN_MAIN_FILE = 'plugin.js'

const pluginWatchers = new Map<string, ReturnType<typeof watchPlugin>>()

export async function rescan() {
    console.debug('scanning plugins')
    const patterns = [PATH + '/*']
    if (APP_PATH !== process.cwd())
        patterns.unshift(adjustStaticPathForGlob(APP_PATH) + '/' + patterns[0]) // first search bundled plugins, because otherwise they won't be loaded because of the folders with same name in .hfs/plugins (used for storage)
    const met = []
    for (const { path, dirent } of await glob(patterns, { onlyFiles: false, suppressErrors: true, objectMode: true })) {
        if (!dirent.isDirectory() || path.endsWith(DISABLING_SUFFIX)) continue
        const id = path.split('/').slice(-1)[0]!
        met.push(id)
        if (!pluginWatchers.has(id))
            pluginWatchers.set(id, watchPlugin(id, join(path, PLUGIN_MAIN_FILE)))
    }
    for (const [id, cancelWatcher] of pluginWatchers.entries())
        if (!met.includes(id)) {
            enablePlugin(id, false)
            cancelWatcher()
            pluginWatchers.delete(id)
        }
}

function watchPlugin(id: string, path: string) {
    console.debug('plugin watch', id)
    const module = resolve(path)
    let starting: PendingPromise | undefined
    const unsub = enablePlugins.sub(() => getPluginInfo(id) && considerStart()) // only after it has been loaded
    const unsub2 = suspendPlugins.sub(() => getPluginInfo(id) && considerStart())
    function considerStart() {
        const should = isPluginEnabled(id, true)
        if (should === isPluginRunning(id)) return
        if (should) {
            start()
            return true
        }
        stop()
    }
    const { unwatch } = watchLoad(module, async source => {
        const notRunning = availablePlugins[id]
        if (!source)
            return onUninstalled()
        if (isPluginEnabled(id, true))
            return start()
        const p = parsePluginSource(id, source)
        if (same(notRunning, p)) return
        availablePlugins[id] = p
        events.emit(notRunning ? 'pluginUpdated' : 'pluginInstalled', p)
    })
    return () => {
        console.debug('plugin unwatch', id)
        unsub()
        unsub2()
        unwatch()
        return onUninstalled()
    }

    async function onUninstalled() {
        await stop()
        if (!getPluginInfo(id)) return // already missing
        delete availablePlugins[id]
        events.emit('pluginUninstalled', id)
    }

    async function markItAvailable() {
        plugins.delete(id)
        availablePlugins[id] = await parsePlugin()
    }

    async function parsePlugin() {
        return parsePluginSource(id, await readFile(module, 'utf8'))
    }

    async function stop() {
        await starting
        const p = plugins.get(id)
        if (!p) return
        await p.unload()
        await markItAvailable().catch(() =>
            events.emit('pluginUninstalled', id)) // when a running plugin is deleted, avoid error and report
        events.emit('pluginStopped', p)
    }

    async function start() {
        if (starting) return
        try {
            starting = pendingPromise()
            // if dependencies are not ready right now, we give some time. Not super-solid but good enough for now.
            const info = await parsePlugin()
            if (!await waitFor(() => _.isEmpty(getMissingDependencies(info)), { timeout: 5_000 }))
                throw Error("plugin missing dependencies: " + _.map(getMissingDependencies(info), x => x.repo).join(', '))
            if (getPluginInfo(id))
                setError(id, '')
            const alreadyRunning = plugins.get(id)
            console.log(alreadyRunning ? "reloading plugin" : "loading plugin", id)
            const pluginData = require(module)
            deleteModule(require.resolve(module)) // avoid caching at next import
            calculateBadApi(pluginData)
            if (pluginData.badApi)
                throw Error(pluginData.badApi)

            await alreadyRunning?.unload(true)
            console.debug("starting plugin", id)
            const storageDir = resolve(PATH, id, STORAGE_FOLDER) + (IS_WINDOWS ? '\\' : '/')
            if (!module.startsWith(process.cwd())) //legacy pre-0.53.0, bundled plugins' storageDir was not under cwd
                await rename(resolve(module, '..', STORAGE_FOLDER), storageDir).catch(() => {})
            await mkdir(storageDir, { recursive: true })
            const openDbs: KvStorage[] = []
            const subbedConfigs: Callback[] = []
            const pluginReady = pendingPromise()
            const MAX_LOG = 100
            await initPlugin(pluginData, { // following properties are not available in server_code
                id,
                srcDir: __dirname,
                storageDir,
                async openDb(filename: string, options?: KvStorageOptions){
                    if (!filename) throw Error("missing filename")
                    const db = new KvStorage(options)
                    await db.open(join(storageDir, filename))
                    openDbs.push(db)
                    return db
                },
                log(...args: any[]) {
                    console.log('plugin', id+':', ...args)
                    pluginReady.then(() => { // log() maybe invoked during init(), while plugin is undefined
                        if (!plugin) return
                        const msg = { ts: new Date, msg: args.map(x => x && typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ') }
                        plugin.log.push(msg)
                        if (plugin.log.length > MAX_LOG)
                            plugin.log.splice(0, 10) // truncate
                        events.emit('pluginLog:' + id, msg)
                        events.emit('pluginLog', id, msg)
                    })
                },
                getConfig(cfgKey?: string) {
                    const cur = pluginsConfig.get()?.[id]
                    return cfgKey ? cur?.[cfgKey] ?? pluginData.config?.[cfgKey]?.defaultValue
                        : _.defaults(cur, objSameKeys(pluginData.config, x => x.defaultValue))
                },
                setConfig: (cfgKey: string, value: any) =>
                    setPluginConfig(id, { [cfgKey]: value }),
                subscribeConfig(cfgKey: string | string[], cb: Callback<any>) {
                    const get = () => Array.isArray(cfgKey) ? objFromKeys(cfgKey, k => this.getConfig(k))
                        : this.getConfig(cfgKey)
                    let last = get()
                    cb(last)
                    const ret = pluginsConfig.sub(() => {
                        const now = get()
                        if (same(now, last)) return
                        try { cb(last = now) }
                        catch(e){ this.log(String(e)) }
                    })
                    subbedConfigs.push(ret)
                    return ret
                },
                async i18n(ctx: any) {
                    return i18nFromTranslations(await getLangData(ctx))
                },
            })
            const folder = dirname(module)
            const { sections, unwatch } = watchLoadCustomHtml(folder)
            pluginData.getCustomHtml = () =>
                Object.assign(Object.fromEntries(sections), callable(pluginData.customHtml) || {})

            const unwatchIcons = watchIconsFolder(folder, v => plugin.icons = v)
            const plugin = new Plugin(id, folder, pluginData, async () => {
                unwatchIcons()
                unwatch()
                for (const x of subbedConfigs) x()
                await Promise.allSettled(openDbs.map(x => x.close()))
                openDbs.length = 0
            })
            pluginReady.resolve()
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
            const parsed = e.stack?.split('\n\n') // this form is used by syntax-errors inside the plugin, which is useful to show
            const where = parsed?.length > 1 ? `\n${parsed[0]}` : ''
            e = prefix('', e.message, where) || String(e)
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
    return getPluginInfo(id)?.error as undefined | string
}

// returns true if there's an error, and it has changed
function setError(id: string, error: string) {
    const info = getPluginInfo(id)
    if (!info) return
    if (info.error === error) return
    info.error = error
    events.emit('pluginUpdated', info)
    if (!error) return
    console.warn(`plugin error: ${id}:`, error)
    return true
}

function deleteModule(id: string) {
    const { cache } = require
    // build reversed map of dependencies
    const requiredBy: Record<string,string[]> = { '.':['.'] } // don't touch main entry
    for (const k in cache)
        if (k !== id)
            for (const child of wantArray(cache[k]?.children))
                (requiredBy[child.id] ||= []).push(k)
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
    pl.description = tryJson(/exports.description\s*=\s*(".*")/.exec(source)?.[1])
    pl.repo = tryJson(/exports.repo\s*=\s*(\S*)/.exec(source)?.[1])
    pl.version = Number(/exports.version\s*=\s*(\d*\.?\d+)/.exec(source)?.[1]) ?? undefined
    pl.apiRequired = tryJson(/exports.apiRequired\s*=\s*([ \d.,[\]]+)/.exec(source)?.[1]) ?? undefined
    pl.isTheme = tryJson(/exports.isTheme\s*=\s*(true|false|"light"|"dark")/.exec(source)?.[1]) ?? (id.endsWith('-theme') || undefined)
    pl.preview = tryJson(/exports.preview\s*=\s*(.+)/.exec(source)?.[1]) ?? undefined
    pl.depend = tryJson(/exports.depend\s*=\s*(\[[\s\S]*?])/m.exec(source)?.[1])?.filter((x: any) =>
        typeof x.repo === 'string' && x.version === undefined || typeof x.version === 'number'
            || console.warn("plugin dependency discarded", x) )
    pl.changelog = tryJson(/exports.changelog\s*=\s*(\[[\s\S]*?])/m.exec(source)?.[1])
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

export function getMissingDependencies(plugin: CommonPluginInterface) {
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
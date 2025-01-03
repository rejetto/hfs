// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ORIGINAL_CWD, VERSION, CONFIG_FILE } from './const'
import { watchLoad } from './watchLoad'
import yaml from 'yaml'
import _ from 'lodash'
import { DAY, debounceAsync, newObj, throw_, tryJson, wait, with_ } from './misc'
import { statSync } from 'fs'
import { join, resolve } from 'path'
import events from './events'
import { copyFile, stat } from 'fs/promises'
import produce, { setAutoFreeze } from 'immer'
import { argv } from './argv'

setAutoFreeze(false) // we still want to mess with objects later (eg: account.belongs)

// keep definition of config properties
const configProps: Record<string, { defaultValue?: unknown }> = {}

let started = false // this will tell the difference for subscribeConfig()s that are called before or after config is loaded
let state: Record<string, any> = {} // current state of config properties
const filePath = with_(argv.config || process.env.HFS_CONFIG, p => {
    if (!p)
        return CONFIG_FILE
    p = resolve(ORIGINAL_CWD, p)
    try {
        if (statSync(p).isDirectory()) // try to detect if path points to a folder, in which case we add the standard filename
            return join(p, CONFIG_FILE)
    }
    catch {}
    return p
})
// takes a semver like 1.2.3-alpha1, but alpha and beta numbers must share the number progression
export const versionToScalar = _.memoize((ver: string) => { // memoize so we don't have to care about converting same value twice
    // this regexp is supposed to be resistant to optional leading "v" and an optional custom name after a space
    const res = /^v?(\d+)\.(\d+)\.(\d+)(?:-\D+([0-9.]+))?/.exec(ver)
    if (!res) return NaN
    const [,a,b,c,beta] = res.map(Number)
    const officialScalar = c! + b! * 1E3 + a! * 1E6 // gives 3 digits for each number
    const betaScalar = 1 / (1 + beta! || Infinity) // beta tends to 0, while non-beta is 0. +1 to make it work even in case of alpha0
    return officialScalar - betaScalar
})

class Version extends String {
    olderThan(otherVersion: string) {
        return versionToScalar(this.valueOf()) < versionToScalar(otherVersion)
    }
    getScalar() {
        return versionToScalar(this.valueOf())
    }
}

const CONFIG_CHANGE_EVENT_PREFIX = 'config.'
export const currentVersion = new Version(VERSION)
const configVersion = defineConfig('version', VERSION, v => new Version(v))

type Subscriber<T,R=void> = (v:T, more: { was?: T, version?: Version, defaultValue: T, k: string }) => R
export function defineConfig<T, CT=unknown>(k: string, defaultValue: T, compiler?: Subscriber<T,CT>) {
    configProps[k] = { defaultValue }
    type Updater = (currentValue:T) => T
    let compiled = compiler?.(defaultValue, { k, version: currentVersion, defaultValue })
    const ret = { // consider a Class
        key() {
            return k
        },
        get(): T {
            return getConfig(k)
        },
        sub(cb: Subscriber<T>) {
            if (started) // initial event already passed, we'll make the first call
                cb(getConfig(k), { k, was: defaultValue, defaultValue, version: configVersion.compiled() })
            return events.on(CONFIG_CHANGE_EVENT_PREFIX + k, (v, was, version) => {
                if (stack.includes(cb)) return // avoid infinite loop in case a subscriber changes the value
                stack.push(cb)
                try { return cb(v, { k, was, version, defaultValue }) }
                finally { stack.pop() }
            }, { warnAfter: 1000 }) // e.g. each plugin watch enable_plugins
        },
        set(v: T | Updater) {
            if (typeof v === 'function')
                this.set(produce(this.get(), v as Updater))
            else
                setConfig1(k, v)
        },
        compiled: () => (compiler ? compiled : throw_("missing compiler")) as CT,
    }
    if (compiler)
        ret.sub((...args) =>
            compiled = compiler(...args) )
    return ret
}

export function configKeyExists(k: string) {
    return configProps.hasOwnProperty(k)
}

const stack: any[] = []

export function getConfig(k:string) {
    return state[k] ?? _.cloneDeep(configProps[k]?.defaultValue) // clone to avoid changing
}

export function getWholeConfig({ omit, only }: { omit?:string[], only?:string[] }) {
    const defs = newObj(configProps, x => x.defaultValue)
    let copy = _.defaults({}, state, defs)
    if (omit?.length)
        copy = _.omit(copy, omit)
    if (only)
       copy = _.pick(copy, only)
    return _.cloneDeep(copy)
}

// pass a value to `save` to force saving decision, or leave undefined for auto. Passing false will also reset previously loaded configs.
export function setConfig(newCfg: Record<string,unknown>, save?: boolean) {
    const version = _.isString(newCfg.version) ? new Version(newCfg.version) : undefined
    const considerEnvs = !process.env['HFS_ENV_BOOTSTRAP'] || !started && _.isEmpty(newCfg)
    // first time we consider also CLI args
    const argCfg = !started && _.pickBy(newObj(configProps,
        (x, k) => argv[k] ?? tryJson(considerEnvs ? process.env['HFS_' + k.toUpperCase().replaceAll('-','_')] : '', _.identity)),
            x => x !== undefined)
    if (! _.isEmpty(argCfg)) {
        saveConfigAsap() // don't set `save` argument, as it would interfere below at check `save===false`
        Object.assign(newCfg, argCfg)
    }
    for (const k in newCfg)
        apply(k, newCfg[k])
    if (save) {
        saveConfigAsap()
        return
    }
    if (started) {
        if (save === false) // false is used when loading whole config, and in such case we should not leave previous values untreated. Also, we need this only after we already `started`.
            for (const k of Object.keys(state))
                if (!newCfg.hasOwnProperty(k))
                    apply(k, undefined)
        return
    }
    // first time we emit also for the default values
    for (const k of Object.keys(configProps))
        if (!newCfg.hasOwnProperty(k))
            apply(k, newCfg[k], true)
    started = true
    events.emit('configReady')
    if (version !== VERSION) // be sure to save version
        saveConfigAsap()

    function apply(k: string, newV: any, isDefault=false) {
        return setConfig1(k, newV, save === undefined, argCfg && k in argCfg || isDefault ? currentVersion : version)
    }
}

function setConfig1(k: string, newV: unknown, saveChanges=true, valueVersion?: Version) {
    if (_.isPlainObject(newV))
        newV = _.pickBy(newV as any, x => x !== undefined)
    const def = configProps[k]?.defaultValue
    if (same(newV ?? null, def ?? null))
        newV = undefined
    if (started && same(newV, state[k])) return // no change
    const was = getConfig(k) // include cloned default, if necessary
    state[k] = newV
    events.emit(CONFIG_CHANGE_EVENT_PREFIX + k, getConfig(k), was, valueVersion)
    if (saveChanges)
        saveConfigAsap()

    function same(a: any, b: any) { // we want to consider order of object entries as well (eg: mime)
        return a === b || JSON.stringify(a) === JSON.stringify(b)
    }
}

const saveDebounced = debounceAsync(async () => {
    while (!started)
        await wait(100)
    // keep backup
    const bak = filePath + '.bak'
    const aWeekAgo = Date.now() - DAY * 7
    if (await stat(bak).then(x => aWeekAgo > Number(x.mtime || x.ctime), () => true))
        await copyFile(filePath, bak).catch(() => {}) // ignore errors

    await configFile.save(stringify({ ...state, version: VERSION }))
        .catch(err => console.error('Failed at saving config file, please ensure it is writable.', String(err)))
})
export const saveConfigAsap = () => void saveDebounced()

function stringify(obj: any) {
    return yaml.stringify(obj, { lineWidth:1000 })
}

console.log("config", filePath)
export const configFile = watchLoad(filePath, text => {
    try { setConfig(yaml.parse(text, { uniqueKeys: false }) || {}, false) }
    catch(e: any) { console.error("Error in", filePath, ':', e.message || String(e)) }
}, {
    failedOnFirstAttempt(){
        console.log("No config file, using defaults")
        setTimeout(() => // this is called synchronously, but we need to call setConfig after first tick, when all configs are defined
            setConfig({}, false))
    }
})

export const showHelp = argv.help
events.on('configReady', () => {
    if (!showHelp) return
    console.log(`HELP
You can pass any configuration in the form: --name value
Most common configurations:
    --create-admin <password>
    --port <port>
    --cert <path>
    --private_key <path>    
    --consoleFile <path>

For a description of each configuration, please refer to https://rejetto.com/hfs-config
    `)
    process.exit(0)
})
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import EventEmitter from 'events'
import { argv, ORIGINAL_CWD, VERSION } from './const'
import { watchLoad } from './watchLoad'
import yaml from 'yaml'
import _ from 'lodash'
import { debounceAsync, same, newObj, onOff, wait, with_ } from './misc'
import { copyFileSync, existsSync, renameSync, statSync } from 'fs'
import { join, resolve } from 'path'
import events from './events'
import { homedir } from 'os'

const FILE = 'config.yaml'

// keep definition of config properties
const configProps: Record<string, { defaultValue?: unknown }> = {}

let started = false // this will tell the difference for subscribeConfig()s that are called before or after config is loaded
let state: Record<string, any> = {} // current state of config properties
const cfgEvents = new EventEmitter()
cfgEvents.setMaxListeners(10_000)
const filePath = with_(argv.config || process.env.HFS_CONFIG, p => {
    if (!p)
        return FILE
    p = resolve(ORIGINAL_CWD, p)
    try {
        if (statSync(p).isDirectory()) // try to detect if path points to a folder, in which case we add the standard filename
            return join(p, FILE)
    }
    catch {}
    return p
})
const legacyPosition = join(homedir(), FILE) // this was happening with npx on Windows for some time. Remove around v0.47
if (!existsSync(filePath) && existsSync(legacyPosition))
    try {
        renameSync(legacyPosition, filePath)
        console.log("moved from legacy position", legacyPosition)
    }
    catch {
        try { // attempt copying, in case moving the source file proves to be impractical
            copyFileSync(legacyPosition, filePath)
            console.log("copied from legacy position", legacyPosition)
        }
        catch {}
    }
// takes a semver like 1.2.3-alpha1, but alpha and beta numbers must share the number progression
const versionToScalar = _.memoize((ver: string) => { // memoize so we don't have to care about converting same value twice
    const [official, beta] = ver.split('-')
    const numbers = official!.split('.').map(Number)
    if (numbers.length !== 3)
        return NaN
    const officialScalar = numbers.reduce((acc,x,i) => acc + x * 1000 ** (2-i), 0) // 1000 gives 3 digits for each number
    const betaScalar = 1 / (beta && Number(/\d+/.exec(beta)?.[0]) || Infinity) // beta tends to 0, while non-beta is 0
    return officialScalar - betaScalar
})

class Version extends String {
    olderThan(otherVersion: string) {
        return versionToScalar(this.valueOf()) < versionToScalar(otherVersion)
    }
}

const CONFIG_CHANGE_EVENT_PREFIX = 'new.'
const currentVersion = new Version(VERSION)
const configVersion = defineConfig('version', VERSION, v => new Version(v))

type Subscriber<T,R=void> = (v:T, was:T | undefined, version: Version | undefined) => R
export function defineConfig<T, CT=T>(k: string, defaultValue: T, compiler?: Subscriber<T,CT>) {
    configProps[k] = { defaultValue }
    type Updater = (currentValue:T) => T
    let compiled = compiler?.(defaultValue, undefined, currentVersion)
    const ret = { // consider a Class
        key() {
            return k
        },
        get(): T {
            return getConfig(k)
        },
        sub(cb: Subscriber<T>) {
            if (started) // initial event already passed, we'll make the first call
                cb(getConfig(k), defaultValue, configVersion.compiled())
            const eventName = CONFIG_CHANGE_EVENT_PREFIX + k
            return onOff(cfgEvents, {
                [eventName]() {
                    if (stack.includes(cb)) return // avoid infinite loop in case a subscriber changes the value
                    stack.push(cb) // @ts-ignore arguments
                    try { return cb.apply(this,arguments) }
                    finally { stack.pop() }
                }
            })
        },
        set(v: T | Updater) {
            if (typeof v === 'function')
                this.set((v as Updater)(this.get()))
            else
                setConfig1(k, v)
        },
        compiled: () => {
            if (!compiler) throw "missing compiler"
            return compiled as CT
        }
    }
    if (compiler)
        ret.sub((...args) =>
            compiled = compiler(...args) )
    return ret
}

export function configKeyExists(k: string) {
    return k in configProps
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
    // first time we consider also CLI args
    const argCfg = !started && _.pickBy(newObj(configProps, (x, k) => argv[k]), x => x !== undefined)
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
                    apply(k, newCfg[k])
        return
    }
    // first time we emit also for the default values
    for (const k of Object.keys(configProps))
        if (!newCfg.hasOwnProperty(k))
            apply(k, newCfg[k], true)
    started = true
    events.emit('config ready')
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
    cfgEvents.emit(CONFIG_CHANGE_EVENT_PREFIX + k, getConfig(k), was, valueVersion)
    if (saveChanges)
        saveConfigAsap()
}

const saveDebounced = debounceAsync(async () => {
    while (!started)
        await wait(100)
    let txt = yaml.stringify({ ...state, version: VERSION }, { lineWidth:1000 })
    if (txt.trim() === '{}')  // most users wouldn't understand
        txt = ''
    save(filePath, txt)
        .catch(err => console.error('Failed at saving config file, please ensure it is writable.', String(err)))
})
export const saveConfigAsap = () => void(saveDebounced())

console.log("config", filePath)
const { save } = watchLoad(filePath, text => setConfig(yaml.parse(text)||{}, false), {
    failedOnFirstAttempt(){
        console.log("No config file, using defaults")
        setConfig({}, false)
    }
})
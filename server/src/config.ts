// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import EventEmitter from 'events'
import { argv } from './const'
import { watchLoad } from './watchLoad'
import yaml from 'yaml'
import _ from 'lodash'
import { debounceAsync, objSameKeys, onOff, wait } from './misc'
import { exists } from 'fs'
import { promisify } from 'util'

const PATH = 'config.yaml'

const configProps:Record<string, ConfigProps<any>> = {}

let started = false // this will tell the difference for subscribeConfig()s that are called before or after config is loaded
let state: Record<string, any> = {}
const cfgEvents = new EventEmitter()
cfgEvents.setMaxListeners(10_000)
const path = argv.config || process.env.HFS_CONFIG || PATH
const { save } = watchLoad(path, values => setConfig(values||{}, false), {
    failedOnFirstAttempt(){
        console.log("No config file, using defaults")
        setTimeout(() => // for consistency with asynchronous success callback (without this http server is started before the koa app is ready)
            setConfig({}, false) )
    }
})

interface ConfigProps<T> {
    defaultValue?: T,
}
export function defineConfig<T>(k: string, defaultValue?: T) {
    configProps[k] = { defaultValue }
    return {
        key() {
            return k
        },
        get() {
            return getConfig(k)
        },
        sub(cb: (v:T, was?:T)=>void) {
            return subscribeConfig(k, cb)
        },
        set(v: T) {
            setConfig({ [k]: v })
        }
    }
}

function subscribeConfig<T>(k:string, cb: (v:T, was?:T)=>void) {
    const { defaultValue } = configProps[k] ?? {}
    const eventName = 'new.'+k
    if (started) {
        let v = state[k]
        if (v === undefined)
            state[k] = v = _.cloneDeep(defaultValue) // clone to avoid changing
        if (v !== undefined)
            cb(v)
    }
    return onOff(cfgEvents, { [eventName]: cb })
}

function getConfig(k:string) {
    return k in state ? state[k] : configProps[k]?.defaultValue
}

export function getWholeConfig({ omit=[], only=[] }: { omit:string[], only:string[] }) {
    let copy = Object.assign(
        objSameKeys(configProps, x => x.defaultValue),
        state,
    )
    copy = _.omit(copy, omit)
    if (only.length)
       copy = _.pick(copy, only)
    return _.cloneDeep(copy)
}

// pass a value to `save` to force saving decision, or leave undefined for auto. Passing false will also reset previously loaded configs.
export function setConfig(newCfg: Record<string,any>, save?: boolean) {
    if (!started) { // first time we consider also CLI args
        const argCfg = _.pickBy(objSameKeys(configProps, (x,k) => argv[k]), x => x !== undefined)
        if (! _.isEmpty(argCfg)) {
            saveConfigAsap().then() // don't set `save` argument, as it would interfere below at check `save===false`
            Object.assign(newCfg, argCfg)
        }
    }
    for (const k in newCfg)
        check(k)
    if (save) {
        saveConfigAsap().then()
        return
    }
    if (started) {
        if (save === false) // false is used when loading whole config, and in such case we should not leave previous values untreated. Also, we need this only after we already `started`.
            for (const k of Object.keys(state))
                if (!newCfg.hasOwnProperty(k))
                    check(k)
        return
    }
    // first time we emit also for the default values
    for (const k of Object.keys(configProps))
        if (!newCfg.hasOwnProperty(k))
            check(k)
    started = true

    function check(k: string) {
        const oldV = started ? getConfig(k) : state[k] // from second time consider also defaultValue
        const newV = newCfg[k]
        const { defaultValue } = configProps[k] ?? {}
        let v = newV ?? _.cloneDeep(defaultValue) // if we have an object we may get into troubles letting others change ours
        const j = JSON.stringify(v)
        if (j === JSON.stringify(oldV)) return // no change
        state[k] = v
        cfgEvents.emit('new.'+k, v, oldV)
        if (save === undefined)
            saveConfigAsap().then()
    }
}

export const saveConfigAsap = debounceAsync(async () => {
    while (!started)
        await wait(100)
    const diff = objSameKeys(state, (v,k) =>
        JSON.stringify(v) === JSON.stringify(configProps[k]?.defaultValue) ? undefined : v)
    let txt = yaml.stringify(diff, { lineWidth:1000 })
    if (txt.trim() === '{}')  // most users wouldn't understand
        if (await promisify(exists)(path)) // if a file exists then empty it, else don't bother creating it
            txt = ''
        else
            return
    save(path, txt)
        .catch(err => console.error('Failed at saving config file, please ensure it is writable.', String(err)))
})

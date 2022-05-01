// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import EventEmitter from 'events'
import { argv } from './const'
import { watchLoad } from './watchLoad'
import yaml from 'yaml'
import _ from 'lodash'
import { debounceAsync, same, objSameKeys, onOff, wait } from './misc'
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
    type Updater = (currentValue:T) => T
    return {
        key() {
            return k
        },
        get(): T {
            return getConfig(k)
        },
        sub(cb: (v:T, was?:T)=>void) {
            return subscribeConfig(k, cb)
        },
        set(v: T | Updater) {
            if (typeof v === 'function')
                this.set((v as Updater)(this.get()))
            else
                setConfig1(k, v)
        }
    }
}

const stack: any[] = []
function subscribeConfig<T>(k:string, cb: (v:T, was?:T)=>void) {
    if (started) // initial event already passed, we'll make the first call
        cb(getConfig(k))
    const eventName = 'new.'+k
    return onOff(cfgEvents, {
        [eventName]() {
            if (stack.includes(cb)) return // avoid infinite loop in case a subscriber changes the value
            stack.push(cb) // @ts-ignore arguments
            try { return cb.apply(this,arguments) }
            finally { stack.pop() }
        }
    })
}

function getConfig(k:string) {
    return state[k] ?? _.cloneDeep(configProps[k]?.defaultValue) // clone to avoid changing
}

export function getWholeConfig({ omit, only }: { omit?:string[], only?:string[] }) {
    const defs = objSameKeys(configProps, x => x.defaultValue)
    let copy = _.defaults({}, state, defs)
    if (omit?.length)
        copy = _.omit(copy, omit)
    if (only)
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
        apply(k, newCfg[k])
    if (save) {
        saveConfigAsap().then()
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
            apply(k, newCfg[k])
    started = true

    function apply(k: string, newV: any) {
        return setConfig1(k, newV, save === undefined)
    }
}

function setConfig1(k: string, newV: any, saveChanges=true) {
    if (_.isPlainObject(newV))
        newV = _.pickBy(newV, x => x !== undefined)
    if (same(newV, configProps[k]?.defaultValue))
        newV = undefined
    if (started && same(newV, state[k])) return // no change
    const was = getConfig(k) // include cloned default, if necessary
    state[k] = newV
    cfgEvents.emit('new.'+k, getConfig(k), was)
    if (saveChanges)
        saveConfigAsap().then()
}

export const saveConfigAsap = debounceAsync(async () => {
    while (!started)
        await wait(100)
    let txt = yaml.stringify(state, { lineWidth:1000 })
    if (txt.trim() === '{}')  // most users wouldn't understand
        if (await promisify(exists)(path)) // if a file exists then empty it, else don't bother creating it
            txt = ''
        else
            return
    save(path, txt)
        .catch(err => console.error('Failed at saving config file, please ensure it is writable.', String(err)))
})

import EventEmitter from 'events'
import { argv } from './const'
import { watchLoad } from './watchLoad'
import fs from 'fs/promises'
import yaml from 'yaml'
import _ from 'lodash'
import { onOffMap } from './misc'

export const CFG_ALLOW_CLEAR_TEXT_LOGIN = 'allow_clear_text_login'

const PATH = 'config.yaml'

let started = false // this will tell the difference for subscribeConfig()s that are called before or after config is loaded
let state:Record<string,any> = {}
const emitter = new EventEmitter()
emitter.setMaxListeners(10_000)
const path = argv.config || process.env.HFS_CONFIG || PATH
watchLoad(path,  data => {
    started = true
    setConfig(data)
}, { failOnFirstAttempt:()=> setConfig({}) })

const configProps:Record<string, ConfigProps<any>> = {}

interface ConfigProps<T> {
    defaultValue?: T,
    caster?:(argV:string)=> T
}
export function defineConfig<T>(k: string, definition: ConfigProps<T>) {
    configProps[k] = definition
    if (!definition.caster)
        if (typeof definition.defaultValue === 'number')
            // @ts-ignore
            definition.caster = Number
}

export function subscribeConfig<T>({ k, ...definition }:{ k:string } & ConfigProps<T>, cb:(v:T, was?:T)=>void) {
    if (definition)
        defineConfig(k, definition)
    const { caster, defaultValue } = configProps[k] ?? {}
    const a = argv[k]
    if (a !== undefined)
        return cb(caster ? caster(a) : a)
    const eventName = 'new.'+k
    if (started) {
        let v = state[k]
        if (v === undefined)
            v = defaultValue
        if (v !== undefined)
            cb(v)
    }
    return onOffMap(emitter, { [eventName]: cb })
}

export function getConfig(k:string) {
    return k in state ? state[k] : configProps[k]?.defaultValue
}

export function getWholeConfig({ omit=[], only=[] }: { omit:string[], only:string[] }) {
    let copy = _.omit(state, omit)
    if (only.length)
       copy = _.pick(copy, only)
    return _.cloneDeep(copy)
}

export function setConfig(newCfg: Record<string,any>, partial=false) {
    for (const k in newCfg)
        check(k)
    const oldKeys = Object.keys(state)
    oldKeys.push(...Object.keys(configProps))
    if (partial)
        return saveConfigAsap()
    for (const k of oldKeys)
        if (!newCfg.hasOwnProperty(k))
            check(k)

    function check(k: string) {
        const oldV = state[k]
        const newV = newCfg[k]
        const { caster, defaultValue } = configProps[k] ?? {}
        let v = newV === undefined ? defaultValue : newV
        if (caster)
            v = caster(v)
        if (JSON.stringify(v) === JSON.stringify(oldV)) return
        state[k] = v
        emitter.emit('new.'+k, v, oldV)
    }
}

export const saveConfigAsap = _.debounce(async () => {
    fs.writeFile(path, yaml.stringify(state))
        .catch(err => console.error('Failed at saving config file, please ensure it is writable.', String(err)))
})

// async version of getConfig, allowing you to wait for config to be ready
export async function getConfigReady<T>(k: string, definition?: object) {
    return new Promise<T>(resolve => {
        const off = subscribeConfig({ k, ...definition }, v => {
            off?.()
            resolve(v as T)
        })
    })
}

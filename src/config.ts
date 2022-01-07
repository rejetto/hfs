import EventEmitter from 'events'
import { argv } from './const'
import { watchLoad } from './watchLoad'

export const CFG_ALLOW_CLEAR_TEXT_LOGIN = 'allow clear text login'

const PATH = 'config.yaml'

let state:Record<string,any> = {}
const emitter = new EventEmitter()
watchLoad(argv.config || process.env.hfs_config || PATH,  data => {
    for (const k in data)
        check(k)
    for (const k in { ...state, ...configProps })
        if (!(k in data))
            check(k)

    function check(k: string) {
        const oldV = state[k]
        const newV = data[k]
        const { caster, defaultValue } = configProps[k] ?? {}
        let v = newV === undefined ? defaultValue : newV
        if (caster)
            v = caster(v)
        if (JSON.stringify(v) === JSON.stringify(oldV)) return
        state[k] = v
        emitter.emit('new.'+k, v, oldV)
    }
})

const configProps:Record<string, ConfigProps> = {}

interface ConfigProps {
    defaultValue?:any,
    caster?:(argV:string)=>any
}
export function defineConfig(k:string, definition:ConfigProps) {
    configProps[k] = definition
    if (!definition.caster)
        if (typeof definition.defaultValue === 'number')
            definition.caster = Number
}

export function subscribeConfig({ k, ...definition }:{ k:string } & ConfigProps, cb:(v:any, was?:any)=>void) {
    if (definition)
        defineConfig(k, definition)
    const { caster } = configProps[k] ?? {}
    const a = argv[k]
    if (a !== undefined)
        return cb(caster ? caster(a) : a)
    emitter.on('new.'+k, cb)
}

export function getConfig(k:string) {
    return state[k]
}

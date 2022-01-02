import EventEmitter from 'events'
import { argv } from './const'
import { watchLoad } from './misc'

const PATH = 'config.yaml'

let state:Record<string,any> = {}
const emitter = new EventEmitter()
watchLoad(PATH,  data => {
    for (const k in data)
        check(k)
    for (const k in state)
        if (!(k in data))
            check(k)

    function check(k: string) {
        const oldV = state[k]
        const newV = data[k]
        if (JSON.stringify(newV) === JSON.stringify(oldV)) return
        state[k] = newV
        emitter.emit('new.'+k, newV, oldV)
    }
})

export function subscribe(k:string, cb:(v:any,was?:any)=>void, defaultValue?:any, caster?:(argV:string)=>any) {
    if (!caster)
        if (typeof defaultValue === 'number')
            caster = Number
    const a = argv[k]
    if (a !== undefined)
        return cb(caster ? caster(a) : a)
    emitter.on('new.'+k, cb)
    if (defaultValue !== undefined)
        cb(defaultValue)
}

export function getConfig(k:string) {
    return state[k]
}

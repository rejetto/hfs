import EventEmitter from 'events'
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

export function subscribe(k:string, cb:(v:any,was:any)=>void) {
    emitter.on('new.'+k, cb)
}

export function getConfig(k:string) {
    return state[k]
}

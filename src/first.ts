// should not import other sources that themselves import this file, to avoid circular dependencies
import { EventEmitter } from 'events'

type ProcessExitHandler = (signal:string) => any
const cbsOnExit = new Set<ProcessExitHandler>()
export function onProcessExit(cb: ProcessExitHandler) {
    cbsOnExit.add(cb)
    return () => cbsOnExit.delete(cb)
}

export let quitting = false
onProcessExit(() => quitting = true)

// 'exit' event is handled as the last resort, but it's not compatible with async callbacks
onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP'], signal =>
    Promise.allSettled(Array.from(cbsOnExit).map(cb => cb(signal))).then(() => {
        console.log('quitting', signal||'')
        process.exit(0)
    }))

// keep calling cb in a sync fashion – returning a promise instead would break the code for argv.updating (update.ts)
export function onFirstEvent(emitter:EventEmitter, events: string[], cb: (...args:any[])=> void) {
    let already = false
    for (const e of events)
        emitter.once(e, (...args) => {
            if (already) return
            already = true
            cb(...args)
        })
}


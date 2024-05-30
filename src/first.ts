// should not import other sources that themselves import this file, to avoid circular dependencies
import { EventEmitter } from 'events'

type ProcessExitHandler = (signal:string) => any
const cbs = new Set<ProcessExitHandler>()
export function onProcessExit(cb: ProcessExitHandler) {
    cbs.add(cb)
    return () => cbs.delete(cb)
}
onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP'], signal =>
    Promise.allSettled(Array.from(cbs).map(cb => cb(signal))).then(() =>
        process.exit(0)))

export function onFirstEvent(emitter:EventEmitter, events: string[], cb: (...args:any[])=> void) {
    let already = false
    for (const e of events)
        emitter.once(e, (...args) => {
            if (already) return
            already = true
            cb(...args)
        })
}


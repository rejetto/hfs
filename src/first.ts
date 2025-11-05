// should not import other sources that themselves import this file, to avoid circular dependencies
import { EventEmitter } from 'events'

type ProcessExitHandler = (signal: unknown) => any
const cbs = new Set<ProcessExitHandler>()
export function onProcessExit(cb: ProcessExitHandler) {
    cbs.add(cb)
    return () => cbs.delete(cb)
}

export let quitting = false
onProcessExit(() => quitting = true)

onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP']).then(([signal]) =>
    Promise.allSettled(Array.from(cbs).map(cb => cb(signal))).then(() => {
        console.log('quitting')
        process.exit(0)
    }))

export function onFirstEvent(emitter: EventEmitter, events: string[]) {
    return new Promise<unknown[]>(resolve => {
        let already = false
        for (const e of events)
            emitter.on(e, listener)

        function listener(...args: any[]) {
            if (already) return
            already = true
            for (const e of events)
                emitter.removeListener(e, listener)
            resolve(args)
        }
    })
}

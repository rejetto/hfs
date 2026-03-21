const asap = globalThis.setImmediate || setTimeout
export function makeQ(parallelization=1, max=Infinity) {
    const running = new Set<Promise<unknown>>()
    const queued: Array<() => Promise<unknown>> = []
    return {
        add(toAdd: typeof queued[0]) {
            if (queued.length >= max + parallelization - running.size) // we may have some free slots that will be used at the next tick
                return false
            queued.push(toAdd)
            asap(startNextIfPossible) // avoid calling now, as it would cause nesting/stacking of jobs
            return true
        },
        isWorking() { return running.size > 0 },
        isFree() { return running.size < parallelization },
        setMax(newMax: number) { max = newMax },
        queueSize() { return queued.length },
    }
    function startNextIfPossible() {
        while (running.size < parallelization) {
            const job = queued.shift()
            if (!job) break // finished
            const working = job() // start the job
            if (!working) continue // it was canceled
            running.add(working)
            working.finally(() => {
                running.delete(working)
                startNextIfPossible()
            })
        }
    }
}
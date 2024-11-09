export function makeQ(parallelization=1) {
    const running = new Set<Promise<unknown>>()
    const queued: Array<() => Promise<unknown>> = []
    return {
        add(toAdd: typeof queued[0]) {
            queued.push(toAdd)
            setTimeout(startNextIfPossible) // avoid nesting/stacking of jobs
        },
        isWorking() { return running.size > 0 },
        isFree() { return running.size < parallelization },
    }
    function startNextIfPossible() {
        while (running.size < parallelization) {
            const job = queued.pop()
            if (!job) break // finished
            const working = job() // start the job
            if (!working) continue // it was canceled
            running.add(working)
            working.then(() => {
                running.delete(working)
                startNextIfPossible()
            })
        }
    }
}
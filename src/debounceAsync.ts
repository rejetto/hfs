// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// like lodash.debounce, but also avoids async invocations to overlap
export function debounceAsync<Cancelable extends boolean = false, A extends unknown[] = unknown[], R = unknown>(
    // the function you want to not call too often, too soon
    callback: (...args: A) => Promise<R>,
    // time to wait after invocation of the debounced function. If you call again while waiting, the timer starts again.
    wait: number=100,
    options: {
        // in a train of invocations, should we execute also the first one, or just the last one?
        leading?: boolean,
        // since the wait-ing is renewed at each invocation, indefinitely, do you want to put a cap to it?
        maxWait?: number,
        // for how long do you want to cache last success value, and return that at next invocation?
        retain?: number,
        // for how long do you want to cache last failure value, and return that at next invocation?
        retainFailure?: number,
        // should we offer a cancel method to the returned function?
        cancelable?: Cancelable
    } = {}
) {
    type MaybeUndefined<T> = Cancelable extends true ? undefined | T : T
    type MaybeR = MaybeUndefined<R>
    const { leading=false, maxWait=Infinity, cancelable=false, retain=0, retainFailure } = options
    let started = 0 // latest callback invocation
    let runningCallback: Promise<R> | undefined // latest callback invocation result
    let latestDebouncer: Promise<MaybeR | R> // latest wrapper invocation
    let waitingSince = 0 // we are delaying invocation since
    let whoIsWaiting: undefined | A // args object identifies the pending instance, and incidentally stores args
    let latestCallback: typeof runningCallback
    let latestHasFailed = false
    let latestTimestamp = 0
    const interceptingWrapper = (...args: A) => latestDebouncer = debouncer(...args)
    return Object.assign(interceptingWrapper, {
        clearRetain: () => latestCallback = undefined,
        flush: () => runningCallback ?? exec(),
        isWorking: () => runningCallback,
        ...cancelable && {
            cancel() {
                waitingSince = 0
                whoIsWaiting = undefined
            }
        }
    })

    async function debouncer(...args: A) {
        if (runningCallback)
            return runningCallback as MaybeR
        const now = Date.now()
        if (latestCallback && now - latestTimestamp < (latestHasFailed ? retainFailure ?? retain : retain))
            return await latestCallback
        whoIsWaiting = args
        waitingSince ||= now
        const waitingCap = maxWait - (now - (waitingSince || started))
        const waitFor = Math.min(waitingCap, leading ? wait - (now - started) : wait)
        if (waitFor > 0)
            await new Promise(resolve => setTimeout(resolve, waitFor))
        if (!whoIsWaiting) { // canceled
            waitingSince = 0
            return undefined as MaybeR
        }
        if (whoIsWaiting !== args) // another fresher call is waiting
            return latestDebouncer
        return exec()
    }

    async function exec() {
        if (!whoIsWaiting) return undefined as MaybeR
        waitingSince = 0
        started = Date.now()
        try {
            const args = whoIsWaiting
            whoIsWaiting = undefined
            runningCallback = Promise.resolve(callback(...args)) // cast to promise, in case callback was not really async (or hybrid)
            runningCallback.then(() => latestHasFailed = false, () => latestHasFailed = true)
            return await runningCallback as MaybeUndefined<R> // await necessary to go-finally at the right time and even on exceptions
        }
        finally {
            latestCallback = runningCallback
            latestTimestamp = Date.now()
            runningCallback = undefined
        }
    }
}

// given a function that works on a batch of requests, returns the function that works on a single request
export function singleWorkerFromBatchWorker<Args extends any[]>(batchWorker: (batch: Args[]) => unknown, { maxWait=Infinity }={}) {
    let batch: Args[] = []
    const debounced = debounceAsync(async () => {
        const ret = batchWorker(batch)
        batch = [] // this is reset as batchWorker starts, but without waiting
        return ret
    }, 100, { maxWait })
    return (...args: Args) => {
        const idx = batch.push(args) - 1
        return debounced().then((x: any) => x[idx])
    }
}
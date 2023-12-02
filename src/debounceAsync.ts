// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// like lodash.debounce, but also avoids async invocations to overlap
export function debounceAsync<Cancelable extends boolean = false, A extends unknown[] = unknown[], R = unknown>(
    callback: (...args: A) => Promise<R>,
    wait: number=100,
    options: { leading?: boolean, maxWait?:number, retain?: number, retainFailure?: number, cancelable?: Cancelable }={}
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
        if (!whoIsWaiting) // canceled
            return void(waitingSince = 0) as MaybeR
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
            runningCallback = callback(...args)
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
export function singleWorkerFromBatchWorker<Args extends any[]>(batchWorker: (batch: Args[]) => unknown) {
    let batch: Args[] = []
    const debounced = debounceAsync(async () => {
        const ret = batchWorker(batch)
        batch = []
        return ret
    })
    return (...args: Args) => {
        batch.push(args)
        return debounced()
    }
}
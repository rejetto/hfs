// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// like lodash.debounce, but also avoids async invocations to overlap
export default function debounceAsync<Cancelable extends boolean = false, A extends unknown[] = unknown[], R = unknown>(
    callback: (...args: A) => Promise<R>,
    wait: number=100,
    options: { leading?: boolean, maxWait?:number, cancelable?: Cancelable }={}
) {
    type MaybeUndefined<T> = Cancelable extends true ? undefined | T : T
    type MaybeR = MaybeUndefined<R>
    const { leading=false, maxWait=Infinity, cancelable=false } = options
    let started = 0 // latest callback invocation
    let runningCallback: Promise<R> | undefined // latest callback invocation result
    let runningDebouncer: Promise<MaybeR> // latest wrapper invocation
    let waitingSince = 0 // we are delaying invocation since
    let whoIsWaiting: undefined | A // args object identifies the pending instance, and incidentally stores args
    const interceptingWrapper = (...args: A) => runningDebouncer = debouncer(...args)
    return Object.assign(interceptingWrapper, {
        flush: () => runningCallback ?? exec(),
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
        whoIsWaiting = args
        waitingSince ||= Date.now()
        const waitingCap = maxWait - (Date.now() - (waitingSince || started))
        const waitFor = Math.min(waitingCap, leading ? wait - (Date.now() - started) : wait)
        if (waitFor > 0)
            await new Promise(resolve => setTimeout(resolve, waitFor))
        if (!whoIsWaiting) // canceled
            return void(waitingSince = 0) as MaybeR
        if (whoIsWaiting !== args) // another fresher call is waiting
            return runningDebouncer
        return exec()
    }

    async function exec() {
        if (!whoIsWaiting) return undefined as MaybeR
        waitingSince = 0
        started = Date.now()
        try {
            runningCallback = callback(...whoIsWaiting)
            return await runningCallback as MaybeUndefined<R> // await necessary to go-finally at the right time and even on exceptions
        }
        finally {
            whoIsWaiting = undefined
            runningCallback = undefined
        }
    }
}


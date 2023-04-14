// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

// like lodash.debounce, but also avoids async invocations to overlap
export default function debounceAsync<CB extends (...args: any[]) => Promise<R>, R>(
    callback: CB,
    wait: number=100,
    { leading=false, maxWait=Infinity }={}
) {
    let started = 0 // latest callback invocation
    let runningCallback: Promise<R> | undefined // latest callback invocation result
    let runningDebouncer: Promise<R | undefined> // latest wrapper invocation
    let waitingSince = 0 // we are delaying invocation since
    let whoIsWaiting: undefined | any[] // args' array object identifies the pending instance, and incidentally stores args
    const interceptingWrapper = (...args:any[]) => runningDebouncer = debouncer.apply(null, args)
    return Object.assign(interceptingWrapper, {
        cancel: () => {
            waitingSince = 0
            whoIsWaiting = undefined
        },
        flush: () => runningCallback ?? exec(),
    })

    async function debouncer(...args:any[]) {
        if (runningCallback)
            return runningCallback
        whoIsWaiting = args
        waitingSince ||= Date.now()
        const waitingCap = maxWait - (Date.now() - (waitingSince || started))
        const waitFor = Math.min(waitingCap, leading ? wait - (Date.now() - started) : wait)
        if (waitFor > 0)
            await new Promise(resolve => setTimeout(resolve, waitFor))
        if (!whoIsWaiting) // canceled
            return void(waitingSince = 0)
        if (whoIsWaiting !== args) // another fresher call is waiting
            return runningDebouncer
        return exec()
    }

    async function exec() {
        if (!whoIsWaiting) return
        waitingSince = 0
        started = Date.now()
        try {
            runningCallback = callback.apply(null, whoIsWaiting)
            return await runningCallback // await necessary to go-finally at the right time and even on exceptions
        }
        finally {
            whoIsWaiting = undefined
            runningCallback = undefined
        }
    }
}


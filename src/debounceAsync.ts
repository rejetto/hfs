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
            return await runningCallback
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
        return await exec()
    }

    async function exec() {
        if (!whoIsWaiting) return
        waitingSince = 0
        started = Date.now()
        try {
            runningCallback = callback.apply(null, whoIsWaiting)
            return await runningCallback
        }
        finally {
            whoIsWaiting = undefined
            runningCallback = undefined
        }
    }
}


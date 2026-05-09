export function expiringCache<T, K=string>(ttlMs: number) {
    if (!ttlMs)
        throw Error('invalid TTL')
    const o = new Map<K,T>()
    return Object.assign(o, {
        invalidate,
        // creator can return undefined if the value should not be cached
        try(k: K, creator: (k: K) => T): T {
            let ret = o.get(k)
            if (ret === undefined) { // undefined = missing, as we don't accept this value in our cache
                ret = creator(k)
                if (ret !== undefined) {
                    o.set(k, ret)
                    Promise.resolve(ret).then(v => {
                        if (v === undefined) // even in a promise, we'll consider undefined as a request to cancel the caching
                            invalidate(k)
                    }, () => {}) // avoid js warning
                        .finally(() => setTimeout(() => invalidate(k), ttlMs)) // wait for async (in case) before starting the timer
                }
            }
            return ret
        },
    })

    function invalidate(k: K) {
        o.delete(k)
    }
}


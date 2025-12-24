export function expiringCache<T, K=string>(ttlMs: number) {
    if (!ttlMs)
        throw Error('invalid TTL')
    const o = new Map<K,T>()
    return Object.assign(o, {
        // creator can return undefined if the value should not be cached. `invalidate` is useful in case you have some custom logic for it, other than ttl.
        try(k: K, creator: (invalidate: () => void) => T): T {
            let ret = o.get(k)
            if (ret === undefined) { // undefined = missing, as we don't accept this value in our cache
                ret = creator(invalidate)
                if (ret !== undefined) {
                    o.set(k, ret)
                    Promise.resolve(ret).then(v => {
                        if (v === undefined) // even in a promise, we'll consider undefined as a request to cancel the caching
                            invalidate()
                    }, () => {}) // avoid js warning
                        .finally(() => setTimeout(invalidate, ttlMs)) // wait for async (in case) before starting the timer
                }
                function invalidate() {
                    o.delete(k)
                }
            }
            return ret
        },
    })
}


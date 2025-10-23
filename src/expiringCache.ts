export function expiringCache<T, K=string>(ttlMs: number) {
    const o = new Map<K,T>()
    return Object.assign(o, {
        try(k: K, creator: () => T): T {
            let ret = o.get(k)
            if (ret === undefined) {
                ret = creator()
                o.set(k, ret)
                // in case of async, wait for it to be done before starting the timer
                Promise.resolve(ret).finally(() => setTimeout(() => o.delete(k), ttlMs)).catch(() => {})
            }
            return ret
        },
    })
}


export function expiringCache<T, K=string>(ttl: number) {
    const o = new Map<K,T>()
    return Object.assign(o, {
        try(k: K, creator: () => T): T {
            let ret = o.get(k)
            if (ret === undefined) {
                ret = creator()
                o.set(k, ret)
                Promise.resolve(ret).then(() =>
                    setTimeout(() => o.delete(k), ttl))
            }
            return ret
        },
    })
}


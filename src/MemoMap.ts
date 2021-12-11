export default class MemoMap<T> {
    map = new Map()
    getOrSet(k: any, maker: () => T) : T {
        let ret = this.map.get(k)
        if (!ret) {
            ret = maker()
            this.map.set(k, ret)
        }
        return ret
    }
}


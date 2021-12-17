/** creates an object iterating an array or an object.
 * The callback(val,key/index) should return [val,key] to set both, or just [val] and they key is kept, or just the key (no array) and val will be kept,
 * or an object to merge with the result, or undefined to skip.
 */
type Key = string | number
type Mapper = (v?: any, k?: Key, src?:any, dst?:object) => any

export function obj(src:any, cb: string | Mapper, skipUndefined:boolean=true, dst:any={}) {
    const short = (typeof cb==='string')
    let i = 0
    if (Array.isArray(src))
        for (const e of src)
            work(e, i++)
    else
        for (const k in src)
            work(src[k], k)
    return dst

    function work(entry:any, k: Key) {
        const r = short ? entry[cb] : cb(entry,k,src,dst)
        if (short)
            add(k, r)
        else if (Array.isArray(r))
            if (r.length===1)
                add(k, r[0])
            else
                add(r[1], r[0])
        else if (r instanceof Object)
            Object.assign(dst, r)
        else
            add(r, entry)
    }

    function add(k: Key | string[], v: any) {
        if (k === undefined || (skipUndefined && v === undefined))
            return
        let o = dst
        if (Array.isArray(k))
            if (k.length === 1)
                k = k[0]
            else {
                const a = k
                k = a.pop() as Key
                for (const k1 of a) // @ts-ignore
                    o = o[k1] instanceof Object ? o[k1] : (o[k1] = {})
            }
        o[k] = v
    }
}

export function objFilter(src:any, cb:Mapper) {
    return obj(src, function(v,k){ // @ts-ignore
        return cb.apply(this,arguments) ? k : undefined
    })
}

export function objSameKeys(src:any, cb:Mapper | string) {
    return obj(src, typeof cb === 'string' ? cb : (...args)=> [cb(...args)])
}

export function objFromKeys(keys: string[], returnValueFromKey:(k:string)=>any, skipUndefined=true) {
    return obj(keys, k => [returnValueFromKey(k), k], skipUndefined)
}

// useful only in the extent of making clear your intentions
export const objSameValues = obj

//** replace object's (or array's) values with those returned by callback
export function remap(obj:any, map:Mapper, skipUndefined=true) {
    if (!obj) return
    if (Array.isArray(obj)) {
        let k = obj.length
        while (k--) {
            const v = map(obj[k], k)
            if (v !== undefined || !skipUndefined)
                obj[k] = v
            else
                obj.splice(k, 1) // will this cause problems if we remove in the middle?
        }
        return
    }
    for (const k in obj) {
        const v = map(obj[k], k)
        if (v !== undefined || !skipUndefined)
            obj[k] = v
        else
            delete obj[k]
    }
}

// replace object's keys using map object. If undefined the key will be removed.
export function remapKeys(obj:any, map:Record<string,string>) {
    if (obj)
        for (const k in obj)
            if (obj.hasOwnProperty(k) && map.hasOwnProperty(k)) {
                const newK = map[k]
                if (newK !== undefined)
                    obj[newK] = obj[k]
                delete obj[k]
            }
    return obj
}

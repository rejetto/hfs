import { KvStorage } from '@rejetto/kvstorage'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { try_, tryJson } from './cross'
import { onProcessExit } from './first'
import { utimes, stat } from 'node:fs/promises'
import { IS_WINDOWS } from './const'

const fsx = try_(() => {
    const lib = require('fs-x-attributes')
    return { set: promisify(lib.set), get: promisify(lib.get) }
}, () => console.warn('fs-x-attributes not available'))

const fileAttrDb = new KvStorage({ defaultPutDelay: 1000, maxPutDelay: 5000 })
onProcessExit(() => fileAttrDb.flush())
const FN = 'file-attr.kv'
if (existsSync(FN))
    fileAttrDb.open(FN)
const FILE_ATTR_PREFIX = 'user.hfs.' // user. prefix to be linux compatible

/* @param v must be JSON-able or undefined */
export async function storeFileAttr(path: string, k: string, v: any) {
    const s = await stat(path).catch(() => null)
    // since we don't have fsx.remove, we simulate it with an empty string
    if (s && await fsx?.set(path, FILE_ATTR_PREFIX + k, v === undefined ? '' : JSON.stringify(v)).then(() => 1, () => 0)) {
        if (IS_WINDOWS) utimes(path, s.atime, s.mtime) // restore timestamps, necessary only on Windows
        return true
    }
    // fallback to our kv-storage
    if (!fileAttrDb.isOpen())
        if (!s && !v) return // file was probably deleted, and we were asked to remove a possible attribute, but there's no fileAttrDb, so we are done, don't create the db file for nothing
        else await fileAttrDb.open(FN)
    // pipe should be a safe separator
    return await fileAttrDb.put(`${path}|${k}`, v)?.catch((e: any) => {
        console.error("couldn't store metadata on", path, String(e.message || e))
        return false
    }) ?? true // if put is undefined, the value was already there
}

export async function loadFileAttr(path: string, k: string) {
    return await fsx?.get(path, FILE_ATTR_PREFIX + k)
            .then((x: any) => x === '' ? undefined : tryJson(String(x)),
                () => fileAttrDb.isOpen() ? fileAttrDb.get(`${path}|${k}`) : null)
        ?? undefined // normalize, as we get null instead of undefined on windows
}

export async function purgeFileAttr() {
    let n = 0
    await Promise.all(Array.from(fileAttrDb.keys()).map(k =>
        access(k).catch(() =>
            n++ && void fileAttrDb.del(k) )))
    if (n)
        await fileAttrDb.rewrite()
    console.log(`removed ${n} entrie(s)`)
}
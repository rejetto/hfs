import { KvStorage } from '@rejetto/kvstorage'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { tryJson } from './cross'
import { onProcessExit } from './first'
// @ts-ignore
const fsx = import('fs-x-attributes').then(x => ({ set: promisify(x.set), get: promisify(x.get) }),
    () => console.log('fs-x-attributes not available') )

const fileAttrDb = new KvStorage({ defaultPutDelay: 1000, maxPutDelay: 5000 })
onProcessExit(() => fileAttrDb.flush())
const FN = 'file-attr.kv'
if (existsSync(FN))
    fileAttrDb.open(FN)
const FILE_ATTR_PREFIX = 'user.hfs.' // user. prefix to be linux compatible
export async function storeFileAttr(path: string, k: string, v: any) {
    if (await fsx.then(x => x?.set(path, FILE_ATTR_PREFIX + k, JSON.stringify(v)).then(() => 1, () => 0)))
        return true
    // fallback to our kv-storage
    if (!fileAttrDb.isOpen())
        await fileAttrDb.open(FN)
    // pipe should be a safe separator
    return await fileAttrDb.put(`${path}|${k}`, v)?.catch((e: any) => {
        console.error("couldn't store metadata on", path, String(e.message || e))
        return false
    }) ?? true // if put is undefined, the value was already there
}

export async function loadFileAttr(path: string, k: string) {
    return await fsx.then(x => x?.get(path, FILE_ATTR_PREFIX + k))
            .then((x: any) => x && tryJson(String(x)), () => {})
            .then((x: any) => x ?? (fileAttrDb.isOpen() ? fileAttrDb.get(`${path}|${k}`) : null))
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
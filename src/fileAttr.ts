import { KvStorage } from '@rejetto/kvstorage'
import { existsSync } from 'fs'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { tryJson } from './cross'
import { onProcessExit } from './first'
// @ts-ignore
import fsx from 'fs-x-attributes'

let fileAttrDb = new KvStorage({ defaultPutDelay: 1000, maxPutDelay: 5000 })
onProcessExit(() => fileAttrDb.flush())
const FN = 'file-attr.kv'
if (existsSync(FN))
    fileAttrDb.open(FN)
const FILE_ATTR_PREFIX = 'user.hfs.' // user. prefix to be linux compatible
export function storeFileAttr(path: string, k: string, v: any) {
    return promisify(fsx.set)(path, FILE_ATTR_PREFIX + k, JSON.stringify(v))
        .catch(async () => { // fallback to our kv-storage
            if (!fileAttrDb.isOpen())
                await fileAttrDb.open(FN)
            return fileAttrDb.put(`${path}|${k}`, v) // pipe should be a safe separator
        }).then(() => true, (e: any) => {
            console.error("couldn't store metadata on", path, String(e.message || e))
            return false
        })
}

export async function loadFileAttr(path: string, k: string) {
    return await promisify(fsx.get)(path, FILE_ATTR_PREFIX + k)
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
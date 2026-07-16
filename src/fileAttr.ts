import { KvStorage } from '@rejetto/kvstorage'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { onlyTruthy, try_, tryJson } from './cross'
import { onProcessExit } from './first'
import { utimes } from 'node:fs/promises'
import { statWithTimeout } from './util-files'
import { IS_WINDOWS } from './const'
import { isAbsolute, join, relative } from 'path'

const fsx = try_(() => {
    const lib = require('fs-x-attributes')
    return { set: promisify(lib.set), get: promisify(lib.get) }
}, () => console.warn('fs-x-attributes not available'))

const FN = 'file-attr.kv'
export const fileAttrDb = new KvStorage({ defaultPutDelay: 1000, maxPutDelay: 5000 })
onProcessExit(() => fileAttrDb.close())
fileAttrDb.open(FN).catch(e =>
    console.error(String(e)))
const FILE_ATTR_PREFIX = 'user.hfs.' // user. prefix to be linux compatible
const FILE_ATTR_KEY_SEPARATOR = '|'

/* @param v must be JSON-able or undefined */
export async function storeFileAttr(path: string, k: string, v: any) {
    const s = await statWithTimeout(path).catch(() => null)
    // since we don't have fsx.remove, we simulate it with an empty string
    if (s && await fsx?.set(path, FILE_ATTR_PREFIX + k, v === undefined ? '' : JSON.stringify(v)).then(() => 1, () => 0)) {
        if (IS_WINDOWS) utimes(path, s.atime, s.mtime) // restore timestamps, necessary only on Windows
        return true
    }
    // fallback to our kv-storage
    return await fileAttrDb.put(fileAttrKey(path, k), v)?.then(() => true, (e: any) => {
        console.error("Couldn't store metadata on", path, String(e.message || e))
        return false
    }) ?? true // if put is undefined, the value was already there
}

export async function loadFileAttr(path: string, k: string) {
    return await fsx?.get(path, FILE_ATTR_PREFIX + k)
            .then((x: any) => x === '' ? undefined : tryJson(String(x)),
                () => fileAttrDb.isOpen() ? fileAttrDb.get(fileAttrKey(path, k)).catch(console.error) : null)
        ?? undefined // normalize, as we get null instead of undefined on windows
}

// remove file-attr for files that don't exist anymore
export async function purgeFileAttr() {
    let n = 0
    await Promise.all(Array.from(fileAttrDb.keys()).map(k => {
        const fn = splitFileAttrKey(k)?.filePath
        return fn && access(fn).catch(() => {
            n++
            return fileAttrDb.del(k)
        })
    }))
    if (n)
        await fileAttrDb.rewrite()
    console.log(`Removed ${n} entrie(s)`)
}

export async function moveStoredFileAttrs(fromPath: string, toPath: string) {
    try {
        if (fromPath === toPath || !fileAttrDb.isOpen())
            return
        const entries = storedFileAttrEntries()
        const affectedEntries = entries.filter(x => isSameOrInside(fromPath, x.filePath))
        if (!affectedEntries.length)
            return
        const affectedWithValues = await Promise.all(affectedEntries.map(async x => ({
            ...x,
            value: await fileAttrDb.get(x.key)
        })))
        const oldDestinationKeys = entries.filter(x => isSameOrInside(toPath, x.filePath)).map(x => x.key)
        // destination attrs must be cleared first because a replaced file may not have all attrs owned by the source
        await Promise.all(oldDestinationKeys.map(k => fileAttrDb.del(k)))
        await Promise.all(affectedWithValues.map(async ({ key, filePath, attr, value }) => {
            const rel = relative(fromPath, filePath)
            // physical path keys the fallback DB, so filesystem moves must carry descendant entries explicitly
            await fileAttrDb.put(fileAttrKey(join(toPath, rel), attr), value)
            await fileAttrDb.del(key)
        }))
    }
    // metadata sync runs after the filesystem mutation, so it must not report the completed file operation as failed
    catch(e: any) { console.error("Couldn't move metadata in file-attr DB", fromPath, toPath, String(e.message || e)) }
}

export async function deleteStoredFileAttrs(path: string) {
    try {
        if (!fileAttrDb.isOpen())
            return
        const keys = storedFileAttrEntries().filter(x => isSameOrInside(path, x.filePath)).map(x => x.key)
        await Promise.all(keys.map(k => fileAttrDb.del(k)))
    }
    // metadata cleanup runs after deletion, so surfacing this would leave clients seeing a false delete failure
    catch(e: any) { console.error("Couldn't delete metadata from file-attr DB", path, String(e.message || e)) }
}

function storedFileAttrEntries() {
    return onlyTruthy(Array.from(fileAttrDb.keys()).map(splitFileAttrKey))
}

function splitFileAttrKey(key: string) {
    const i = key.lastIndexOf(FILE_ATTR_KEY_SEPARATOR)
    if (i < 0)
        return
    return {
        key,
        filePath: key.slice(0, i),
        attr: key.slice(i + 1)
    }
}

function fileAttrKey(path: string, attr: string) {
    return path + FILE_ATTR_KEY_SEPARATOR + attr
}

function isSameOrInside(parent: string, path: string) {
    const rel = relative(parent, path)
    return rel === '' || Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { access, mkdir, readFile } from 'fs/promises'
import { Promisable, try_, wait, isWindowsDrive } from './cross'
import { createWriteStream, mkdirSync, watch, ftruncate } from 'fs'
import { basename, dirname } from 'path'
import glob from 'fast-glob'
import { IS_WINDOWS } from './const'
import { once } from 'events'
import { Readable } from 'stream'
import { statWithTimeout } from './stat'
// @ts-ignore
import unzipper from 'unzip-stream'

export { statWithTimeout }

export async function isDirectory(path: string) {
    try { return (await statWithTimeout(path)).isDirectory() }
    catch {}
}

export async function readFileBusy(path: string): Promise<string> {
    return readFile(path, 'utf8').catch(e => {
        if ((e as any)?.code !== 'EBUSY')
            throw e
        console.debug('busy')
        return wait(100).then(()=> readFileBusy(path))
    })
}

export function watchDir(dir: string, cb: ()=>void, atStart=false) {
    let watcher: ReturnType<typeof watch>
    let paused = false
    try {
        watcher = watch(dir, controlledCb)
    }
    catch {
        // failing watching the content of the dir, we try to monitor its parent, but filtering events only for our target dir
        const base = basename(dir)
        try {
            watcher = watch(dirname(dir), (event,name) => {
                if (name !== base) return
                try {
                    watcher.close() // if we succeed, we give up the parent watching
                    watcher = watch(dir, controlledCb) // attempt at passing to a more specific watching
                }
                catch {}
                controlledCb()
            })
        }
        catch (e) {
            console.debug(String(e))
        }
    }
    if (atStart)
        controlledCb()
    return {
        working() { return Boolean(watcher) },
        stop() { watcher?.close() },
        pause() { paused = true },
        unpause() { paused = false },
    }

    function controlledCb() {
        if (!paused)
            cb()
    }
}

export function dirTraversal(s?: string) {
    return s && /(^|[/\\])\.\.($|[/\\])/.test(s)
}

// apply this to paths that may contain \ as separator (not supported by fast-glob) and other special chars to be escaped (parenthesis)
export function adjustStaticPathForGlob(path: string) {
    return glob.escapePath(path.replace(/\\/g, '/'))
}

export async function unzip(stream: Readable, cb: (path: string) => Promisable<false | string>) {
    let pending: Promise<any> = Promise.resolve()
    return new Promise((resolve, reject) =>
        stream.pipe(unzipper.Parse())
            .on('end', () => pending.then(resolve))
            .on('error', reject)
            .on('entry', (entry: any) =>
                pending = pending.then(async () => { // don't overlap writings
                    const { path, type } = entry
                    const dest = await try_(() => cb(path), e => console.warn(String(e)))
                    if (!dest || type !== 'File')
                        return entry.autodrain()
                    console.debug('unzip', dest)
                    const thisFile = entry.pipe(await safeWriteStream(dest))
                    await once(thisFile, 'finish')
                }) )
    )
}

export async function prepareFolder(path: string, dirnameIt=true) {
    if (dirnameIt)
        path = dirname(path)
    if (isWindowsDrive(path)) return
    try {
        await mkdir(path, { recursive: true })
        return true
    }
    catch {
        return false
    }
}

export function createFileWithPath(path: string, options?: Parameters<typeof createWriteStream>[1]) {
    const folder = dirname(path)
    if (!isWindowsDrive(folder)) // can't use prepareFolder because it's async
        try { mkdirSync(folder, { recursive: true }) }
        catch {
            return
        }
    return createWriteStream(path, options)
}

export async function safeWriteStream(path: string, options?: Parameters<typeof createWriteStream>[1]) {
    await prepareFolder(path)
    return new Promise<ReturnType<typeof createWriteStream>>((resolve, reject) => {
        const first = createWriteStream(path, options)
            .on('open', () => resolve(first))
            .on('error', (e: any) => {
                if (!IS_WINDOWS || e.code !== 'EPERM')  // Windows throws EPERM for hidden files with flags 'w' and 'a'
                    return reject(e)
                if (typeof options === 'string')
                    options = { encoding: options }
                else
                    options ||= {}
                if (options.flags && options.flags !== 'w') // we only handle the 'w' case
                    return reject(e)
                options.flags = 'r+'
                const second = createWriteStream(path, options)
                    .on('open', fd => ftruncate(fd, 0, () => resolve(second)))
                    .on('error', reject)
            })
    })
}

export function isValidFileName(name: string) {
    return !(IS_WINDOWS ? /[/:"*?<>|\\]/ : /\//).test(name) && !dirTraversal(name)
}

export function exists(path: string) {
    return access(path).then(() => true, () => false)
}

// parse a file, caching unless timestamp has changed
export const parseFileCache = new Map<string, { ts: Date, parsed: unknown }>()
export async function parseFile<T>(path: string, parse: (path: string) => T) {
    const { mtime: ts } = await statWithTimeout(path)
    const cached = parseFileCache.get(path)
    if (cached && Number(ts) === Number(cached.ts))
        return cached.parsed as T
    const parsed = parse(path)
    parseFileCache.set(path, { ts, parsed })
    return parsed
}

export async function parseFileContent<T>(path: string, parse: (raw: Buffer) => T) {
    return parseFile(path, () => readFile(path).then(parse))
}
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { wait } from './misc'
import { createWriteStream, mkdirSync, watch } from 'fs'
import { basename, dirname } from 'path'
import glob from 'fast-glob'
import { IS_WINDOWS } from './const'
import { runCmd } from './util-os'
import { once, Readable } from 'stream'
// @ts-ignore
import unzipper from 'unzip-stream'

export async function isDirectory(path: string) {
    try { return (await fs.stat(path)).isDirectory() }
    catch { return false }
}

export async function readFileBusy(path: string): Promise<string> {
    return fs.readFile(path, 'utf8').catch(e => {
        if ((e as any)?.code !== 'EBUSY')
            throw e
        console.debug('busy')
        return wait(100).then(()=> readFileBusy(path))
    })
}

export function watchDir(dir: string, cb: ()=>void) {
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

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

// apply this to paths that may contain \ as separator (not supported by fast-glob) and other special chars to be escaped (parenthesis)
export function adjustStaticPathForGlob(path: string) {
    return glob.escapePath(path.replace(/\\/g, '/'))
}

export async function* dirStream(path: string, deep=0) {
    if (!await isDirectory(path))
        throw Error('ENOTDIR')
    const dirStream = glob.stream(deep ? '**/*' : '*', {
        cwd: path,
        dot: true,
        deep: deep + 1,
        onlyFiles: false,
        suppressErrors: true,
        objectMode: true,
    })
    const skip = await getItemsToSkip(path)
    for await (const entry of dirStream) {
        let { path, dirent } = entry as any
        const isDir = dirent.isDirectory()
        if (!isDir && !dirent.isFile()) continue
        path = String(path)
        if (!skip?.includes(path))
            yield [path, isDir]
    }

    async function getItemsToSkip(path: string) {
        if (!IS_WINDOWS) return
        const winPath = path.replace(/\//g, '\\')
        const out = await runCmd('dir', ['/ah', '/b', deep ? '/s' : '', winPath])
            .catch(()=>'') // error in case of no matching file
        return out.split('\r\n').slice(0,-1).map(x =>
            !deep ? x : x.slice(winPath.length + 1).replace(/\\/g, '/'))
    }
}

export async function unzip(stream: Readable, cb: (path: string) => false | string) {
    let pending: Promise<any> = Promise.resolve()
    return new Promise(resolve =>
        stream.pipe(unzipper.Parse())
            .on('end', () => pending.then(resolve))
            .on('entry', async (entry: any) => {
                const { path, type } = entry
                const dest = cb(path)
                if (!dest || type !== 'File')
                    return entry.autodrain()
                await pending // don't overlap writings
                console.debug('unzip', dest)
                await prepareFolder(dest)
                const thisFile = entry.pipe(createWriteStream(dest))
                pending = once(thisFile, 'finish')
            })
    )
}

export async function prepareFolder(path: string, dirnameIt=true) {
    if (dirnameIt)
        path = dirname(path)
    if (isWindowsDrive(path)) return
    try {
        await fs.mkdir(path, { recursive: true })
        return true
    }
    catch {
        return false
    }
}

export function createFileWithPath(path: string, options?: Parameters<typeof createWriteStream>[1]) {
    const folder = dirname(path)
    if (!isWindowsDrive(folder))
        try { mkdirSync(folder, { recursive: true }) }
        catch {
            return
        }
    return createWriteStream(path, options)
}

export function isValidFileName(name: string) {
    return !/^\.\.?$|[/:*?"<>|\\]/.test(name)
}
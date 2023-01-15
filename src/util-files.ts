// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import fs from 'fs/promises'
import { wait } from './misc'
import { createWriteStream, mkdirSync, watch } from 'fs'
import { basename, dirname } from 'path'
import glob from 'fast-glob'
import { IS_WINDOWS } from './const'
import { execFile } from 'child_process'
import { once, Readable } from 'stream'
// @ts-ignore
import unzipper from 'unzip-stream'

export async function isDirectory(path: string) {
    try { return (await fs.stat(path)).isDirectory() }
    catch { return false }
}

export async function isFile(path: string) {
    try { return (await fs.stat(path)).isFile() }
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

export async function* dirStream(path: string, deep?: number) {
    if (!await isDirectory(path))
        throw Error('ENOTDIR')
    const dirStream = glob.stream(deep ? '**/*' : '*', {
        cwd: path,
        dot: true,
        deep,
        onlyFiles: false,
        suppressErrors: true,
        objectMode: true,
    })
    const skip = await getItemsToSkip(path)
    for await (const entry of dirStream) {
        let { path, dirent } = entry as any
        if (!dirent.isDirectory() && !dirent.isFile()) continue
        path = String(path)
        if (!skip?.includes(path))
            yield path
    }

    async function getItemsToSkip(path: string) {
        if (!IS_WINDOWS) return
        const out = await run('dir', ['/ah', '/b', path.replace(/\//g, '\\')])
            .catch(()=>'') // error in case of no matching file
        return out.split('\r\n').slice(0,-1)
    }
}

export function run(cmd: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) =>
        execFile('cmd', ['/c', cmd, ...args], (err, stdout) => {
            if (err)
                reject(err)
            else
                resolve(stdout)
        }))
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
                mkdirSync(dirname(dest), { recursive: true }) // easy way be sure to have the folder ready before proceeding
                const thisFile = entry.pipe(createWriteStream(dest))
                pending = once(thisFile, 'finish')
            })
    )
}


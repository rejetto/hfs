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
    try { watch(dir, cb) }
    catch {
        // failing watching the content of the dir, we try to monitor its parent, but filtering events only for our target dir
        const base = basename(dir)
        try {
            const watcher = watch(dirname(dir), (event,name) => {
                if (name !== base) return
                try {
                    watch(dir, cb) // attempt at passing to a more specific watching
                    watcher.close() // if we succeed, we give up the parent watching
                }
                catch {}
                cb()
            })
        }
        catch (e) {
            console.debug(String(e))
            return false
        }
    }
}

export function dirTraversal(s?: string) {
    return s && /(^|[/\\])\.\.($|[/\\])/.test(s)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export async function* dirStream(path: string) {
    const stats = await fs.stat(path)
    if (!stats.isDirectory())
        throw Error('ENOTDIR')
    const dirStream = glob.stream('*', {
        cwd: path,
        dot: true,
        onlyFiles: false,
        suppressErrors: true,
    })
    const skip = await getItemsToSkip(path)
    for await (let path of dirStream) {
        if (path instanceof Buffer)
            path = path.toString('utf8')
        if (skip?.includes(path))
            continue
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


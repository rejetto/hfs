import { makeQ } from './makeQ'
import { appendFile, lstat, mkdtemp, open, opendir, realpath, rm } from 'fs/promises'
import { tmpdir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { IS_WINDOWS } from './const'
import { join } from 'path'
import { pendingPromise, Promisable } from './cross'
import { Stats, Dirent, Dir } from 'node:fs'
import events from './events'
import _ from 'lodash'
import { Context } from 'koa'
import fswin from 'fswin'
import { statWithTimeout } from './util-files'

interface DirStreamEntry extends Dirent {
    closingBranch?: Promise<string>
    stats?: Stats
}

const MAX_SERIAL_DIRECTORY_HANDLES = 16

class DirectorySnapshotError extends Error {
    constructor(cause: unknown) {
        super("Couldn't buffer directory entries", { cause })
    }
}

export function isFatalDirectoryWalkError(error: unknown) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    return error instanceof DirectorySnapshotError || code === 'EMFILE' || code === 'ENFILE'
}

// cb returns void = just go on, null = stop, false = go on but don't recur (in case of depth)
export async function walkDir(path: string, { depth = 0, hidden = true, parallelizeRecursion = false, ctx, onDirectoryEnd }: {
    depth?: number,
    hidden?: boolean,
    parallelizeRecursion?: boolean,
    ctx?: Context,
    onDirectoryEnd?: (path: string) => void,
}, cb: (e: DirStreamEntry) => Promisable<void | null | false>) {
    const root = await statWithTimeout(path).catch(ignorePathError)
    if (!root?.isDirectory()) throw Error('ENOTDIR')
    // suspended consumers must not occupy another request's directory workers
    const dirQ = makeQ(3)
    const done = pendingPromise<void>()
    let stopped = false
    const closingQ: string[] = []
    dirQ.add(() => readDir('', depth, [path])
        .then(res => { // don't make the job await for it, but use it to know it's over
            Promise.resolve(res?.branchDone).then(done.resolve, stopWithError)
        }, stopWithError)
    )
    return done

    function stopWithError(error: unknown) {
        stopped = true
        done.reject(error)
    }

    function ignorePathError(error: unknown) {
        if (isFatalDirectoryWalkError(error)) throw error
        return null
    }

    function isStopped() {
        return stopped || Boolean(ctx?.isAborted())
    }

    async function readDir(relativePath: string, depth: number, ancestorPaths: string[]) {
        if (isStopped()) return
        const base = join(path, relativePath)
        const subDirsDone = new Set<Promise<unknown>>()
        let last: DirStreamEntry | undefined

        const res = (await events.emitAsync('listDiskFolder', { path: base, ctx, hidden }))?.[0] // consider only first result
        const pluginReceiver = _.isFunction(res) && res || null
        const pluginIterator = _.isFunction(res?.[Symbol.asyncIterator] || res?.[Symbol.iterator]) && res as Dir

        let completed = false
        try {
            // fswin.find cannot pause its callbacks, so pull entries and retain native Windows attributes separately
            const entries = pluginIterator || (parallelizeRecursion || ancestorPaths.length <= MAX_SERIAL_DIRECTORY_HANDLES
                ? await opendir(base) : directorySnapshot(base, isStopped))
            for await (let entry of entries) {
                if (isStopped()) break
                const attributes = IS_WINDOWS && !pluginIterator
                    ? await fswin.getAttributesAsync(join(base, entry.name)) : undefined
                if (attributes === null) continue
                if (!hidden && attributes?.IS_HIDDEN) continue
                if (!hidden && !IS_WINDOWS && entry.name[0] === '.')
                    continue
                // stat follows links, so preserve their identity for cycle detection
                const isSymlink = attributes?.IS_REPARSE_POINT || entry.isSymbolicLink?.()
                const stats = !attributes && isSymlink && await statWithTimeout(join(base, entry.name)).catch(ignorePathError)
                if (stats === null) continue
                if (stats)
                    entry = new DirentFromStats(entry.name, stats)
                const expanded: DirStreamEntry = entry
                if (stats)
                    expanded.stats = stats
                else if (attributes) {
                    expanded.stats = {
                        size: attributes.SIZE,
                        birthtime: attributes.CREATION_TIME, birthtimeMs: attributes.CREATION_TIME.getTime(),
                        mtime: attributes.LAST_WRITE_TIME, mtimeMs: attributes.LAST_WRITE_TIME.getTime(),
                        isFile: () => !attributes.IS_DIRECTORY,
                        isDirectory: () => attributes.IS_DIRECTORY,
                    } as Stats
                    expanded.isDirectory = () => attributes.IS_DIRECTORY
                    expanded.isFile = () => !attributes.IS_DIRECTORY
                }
                await work(expanded, isSymlink)
                if (isStopped()) break
            }
            completed = !isStopped()
        }
        finally { pluginReceiver?.(completed) }
        // completed branches can release permission ancestors retained by the VFS walker
        const branchDone = Promise.allSettled(subDirsDone).then(() => onDirectoryEnd?.(relativePath))
        if (last) // using streams, we don't know when the entries are received, so we need to notify on last item
            last.closingBranch = branchDone.then(() => relativePath)
        else
            closingQ.push(relativePath) // ok, we'll ask next one to carry this info
        // don't return the promise directly, as this job ends here, but communicate to caller the promise for the whole branch
        return { branchDone }

        async function work(entry: DirStreamEntry, isSymlink=false) {
            entry.path = (relativePath && relativePath + '/') + entry.name
            pluginReceiver?.(entry)
            if (last && closingQ.length) // pending entries
                last.closingBranch = Promise.resolve(closingQ.shift()!)
            last = entry
            const res = await cb(entry)
            if (res === null) return stopped = true
            if (res === false) return
            if (!depth || !entry.isDirectory()) return
            const entryPath = join(base, entry.name)
            if (isSymlink) {
                // compare only with ancestors so separate links to the same folder still work
                const [target, ...ancestors] = await Promise.all(
                    [entryPath, ...ancestorPaths].map(x => realpath(x).catch(ignorePathError)))
                if (!target || ancestors.includes(target)) {
                    // release the VFS state here because this branch will never be opened
                    onDirectoryEnd?.(entry.path)
                    return
                }
            }
            const branchDone = pendingPromise() // per-job
            subDirsDone.add(branchDone)
            void branchDone.then(() => subDirsDone.delete(branchDone))
            const job = () =>
                readDir(entry.path, depth - 1, [...ancestorPaths, entryPath]) // recur
                    .catch(error => {
                        // resource exhaustion must abort the listing instead of omitting the subtree
                        if (isFatalDirectoryWalkError(error)) stopWithError(error)
                    })
                    .then(res => { // don't await, as readDir must resolve without branch being done
                        if (!res) {
                            // empty branches report themselves; only skipped or failed reads need a notification here
                            closingQ.push(entry.path)
                            onDirectoryEnd?.(entry.path)
                        }
                        Promise.resolve(res?.branchDone).then(() =>
                            branchDone.resolve())
                    })
            if (parallelizeRecursion)
                dirQ.add(job)
            else
                await job()
        }
    }
}

// node has no resumable directory cursor, so deeper serial walks save names without holding an ancestor handle or a full directory in memory
async function* directorySnapshot(path: string, stopped: () => boolean) {
    let folder = ''
    const batch: Dirent[] = []
    try {
        for await (const entry of await opendir(path)) {
            if (stopped()) return
            if (batch.length === 64) {
                // small directories fit in one batch and need no scratch file
                if (!folder) folder = await mkdtemp(join(tmpdir(), 'hfs-directory-')).catch(snapshotError)
                await flush()
            }
            batch.push(entry)
        }
        if (!folder) {
            yield* batch
            return
        }
        await flush()
        const file = join(folder, 'entries')

        const chunk = Buffer.alloc(16 * 1024)
        const decoder = new StringDecoder()
        let pending = '', offset = 0
        while (!stopped()) {
            const handle = await open(file, 'r').catch(snapshotError)
            let bytesRead: number
            // recursive consumers can suspend after a yield, so each batch closes its handle first
            try { ({ bytesRead } = await handle.read(chunk, 0, chunk.length, offset).catch(snapshotError)) }
            finally { await handle.close().catch(snapshotError) }
            if (!bytesRead) break
            offset += bytesRead
            const names = (pending + decoder.write(chunk.subarray(0, bytesRead))).split('\0')
            pending = names.pop()!
            for (const name of names) {
                if (stopped()) return
                const stats = await lstat(join(path, name)).catch(error => {
                    if (error.code !== 'ENOENT') throw error
                })
                if (stats) {
                    const entry = new DirentFromStats(name, stats)
                    entry.parentPath = path
                    yield entry
                }
            }
        }

        async function flush() {
            const names = batch.map(entry => entry.name).join('\0') + '\0'
            await appendFile(join(folder, 'entries'), names, { mode: 0o600 }).catch(snapshotError)
            batch.length = 0
        }
    }
    finally {
        if (folder) try { await rm(folder, { recursive: true, force: true }) }
        catch (error) { console.error("Couldn't remove temporary directory listing", String(error)) }
    }

    function snapshotError(error: unknown): never {
        throw new DirectorySnapshotError(error)
    }
}

type DirentStatsKeysIntersection = keyof Dirent & keyof Stats;
const kStats = Symbol('stats')
// Adapting an internal class in Node.js to mimic the behavior of `Dirent` when creating it manually from `Stats`.
// https://github.com/nodejs/node/blob/a4cf6b204f0b160480153dc293ae748bf15225f9/lib/internal/fs/utils.js#L199C1-L213
export class DirentFromStats extends Dirent {
    private readonly [kStats]: Stats;
    constructor(name: string, stats: Stats) {
        // @ts-expect-error The constructor has parameters, but they are not represented in types.
        // https://github.com/nodejs/node/blob/a4cf6b204f0b160480153dc293ae748bf15225f9/lib/internal/fs/utils.js#L164
        super(name, null);
        this[kStats] = stats;
    }
}

for (const key of Reflect.ownKeys(Dirent.prototype)) {
    const name = key as DirentStatsKeysIntersection | 'constructor';
    if (name === 'constructor' || typeof name === 'symbol')
        continue;
    DirentFromStats.prototype[name] = function () {
        return this[kStats][name]();
    };
}

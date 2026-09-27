import { makeQ } from './makeQ'
import { opendir, realpath } from 'fs/promises'
import { IS_WINDOWS } from './const'
import { join } from 'path'
import { pendingPromise, Promisable } from './cross'
import { Stats, Dirent, Dir } from 'node:fs'
import events from './events'
import _ from 'lodash'
import { Context } from 'koa'
import fswin from 'fswin'
import { isDirectory, statWithTimeout } from './util-files'
import { getCachedDirectory } from './directoryCache'

interface DirStreamEntry extends Dirent {
    closingBranch?: Promise<string>
    stats?: Stats
    hidden?: boolean
    isLink?: boolean
}

const dirQ = makeQ(3)

// cb returns void = just go on, null = stop, false = go on but don't recur (in case of depth)
export function walkDir(path: string, { depth = 0, hidden = true, parallelizeRecursion = false, ctx, useCache = false, diskOnly = false }: {
    depth?: number,
    hidden?: boolean,
    parallelizeRecursion?: boolean,
    ctx?: Context,
    useCache?: boolean,
    diskOnly?: boolean,
}, cb: (e: DirStreamEntry) => Promisable<void | null | false>) {
    let stopped = false
    const closingQ: string[] = []
    const rootCached = useCache && getCachedDirectory(path)
    return new Promise(async (resolve, reject) => {
        if (!rootCached && !await isDirectory(path))
            return reject(Error('ENOTDIR'))
        dirQ.add(() => readDir('', depth, [path])
            .then(res => { // don't make the job await for it, but use it to know it's over
                Promise.resolve(res?.branchDone).then(resolve)
            }, reject)
        )
    })

    async function readDir(relativePath: string, depth: number, ancestorPaths: string[]) {
        if (stopped) return
        const base = join(path, relativePath)
        const subDirsDone: Promise<any>[] = []
        let n = 0
        let last: DirStreamEntry | undefined

        const res = !diskOnly && (await events.emitAsync('listDiskFolder', { path: base, ctx, hidden }))?.[0] // consider only first result
        const pluginReceiver = _.isFunction(res) && res || null
        const pluginIterator = _.isFunction(res?.[Symbol.asyncIterator] || res?.[Symbol.iterator]) && res as Dir
        const cached = useCache && !pluginIterator && (relativePath ? getCachedDirectory(base) : rootCached)

        if (cached) {
            for (const entry of cached) {
                if (stopped) break
                if (!hidden && entry.hidden) continue
                await work(entry, entry.isLink)
            }
        }
        else if (IS_WINDOWS && !pluginIterator && !diskOnly) { // use native apis to read the 'hidden' attribute
            // fswin callbacks cannot await, so track their work before closing the branch
            const entriesWorking: Promise<unknown>[] = []
            const direntMethods = {
                isDir: false,
                isFile(){ return !this.isDir },
                isDirectory(){ return this.isDir },
                isBlockDevice(){ return false },
                isCharacterDevice() { return false },
            }
            await new Promise<void>((resolve, reject) => fswin.find(base + '\\*', (event, f) => {
                if (event !== 'FOUND') {
                    Promise.all(entriesWorking).then(() => resolve())
                    return
                }
                if (stopped) return true // stop signal
                if (!hidden && f.IS_HIDDEN) return
                entriesWorking.push(work(Object.assign(Object.create(direntMethods), {
                    isDir: f.IS_DIRECTORY,
                    name: f.LONG_NAME,
                    hidden: f.IS_HIDDEN,
                    stats: {
                        size: f.SIZE,
                        birthtime: f.CREATION_TIME, birthtimeMs: f.CREATION_TIME.getTime(),
                        mtime: f.LAST_WRITE_TIME, mtimeMs: f.LAST_WRITE_TIME.getTime(),
                        isFile: () => !f.IS_DIRECTORY,
                        isDirectory: () => f.IS_DIRECTORY,
                    } as Stats
                }), Boolean(f.REPARSE_POINT_TAG)).catch(reject))
            }, true))
        }
        else for await (let entry of (pluginIterator || await opendir(base))) {
            if (stopped) break
            if (!hidden && !IS_WINDOWS && entry.name[0] === '.')
                continue
            // stat follows links, so preserve their identity for cycle detection
            const isSymlink = entry.isSymbolicLink?.()
            const stats = isSymlink && await statWithTimeout(join(base, entry.name)).catch(() => null)
            if (stats === null) continue
            if (stats)
                entry = new DirentFromStats(entry.name, stats)
            const expanded: DirStreamEntry = entry
            if (stats)
                expanded.stats = stats
            if (IS_WINDOWS && diskOnly) {
                // cache snapshots need opendir's read errors; fswin.find cannot distinguish failure from an empty result
                const attributes = await new Promise<fswin.Attributes | null>(resolve => {
                    if (!fswin.getAttributes(join(base, entry.name), attributes => resolve(attributes || null)))
                        resolve(null)
                })
                if (!attributes)
                    throw Error("Could not read file attributes: " + join(base, entry.name))
                expanded.hidden = attributes.IS_HIDDEN
            }
            await work(expanded, isSymlink)
        }
        pluginReceiver?.(!stopped)
        const branchDone = Promise.allSettled(subDirsDone)
        if (last) // using streams, we don't know when the entries are received, so we need to notify on last item
            last.closingBranch = branchDone.then(() => relativePath)
        else
            closingQ.push(relativePath) // ok, we'll ask next one to carry this info
        // don't return the promise directly, as this job ends here, but communicate to caller the promise for the whole branch
        return { branchDone, n }

        async function work(entry: DirStreamEntry, isSymlink=false) {
            entry.isLink = isSymlink
            entry.hidden ??= !IS_WINDOWS && entry.name.startsWith('.')
            entry.path = (relativePath && relativePath + '/') + entry.name
            pluginReceiver?.(entry)
            if (last && closingQ.length) // pending entries
                last.closingBranch = Promise.resolve(closingQ.shift()!)
            last = entry
            const res = await cb(entry)
            if (res === null) return stopped = true
            if (res === false) return
            n++
            if (!depth || !entry.isDirectory()) return
            const entryPath = join(base, entry.name)
            if (isSymlink) {
                // compare only with ancestors so separate links to the same folder still work
                const [target, ...ancestors] = await Promise.all(
                    [entryPath, ...ancestorPaths].map(x => realpath(x).catch(() => '')))
                if (!target || ancestors.includes(target)) return
            }
            const branchDone = pendingPromise() // per-job
            subDirsDone.push(branchDone)
            const job = () =>
                readDir(entry.path, depth - 1, [...ancestorPaths, entryPath]) // recur
                    .then(x => x, () => {}) // mute errors
                    .then(res => { // don't await, as readDir must resolve without branch being done
                        if (!res?.n)
                            closingQ.push(entry.path) // no children to tell i'm done
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

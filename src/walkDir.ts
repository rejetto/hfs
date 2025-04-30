import { makeQ } from './makeQ'
import { stat, opendir } from 'fs/promises'
import { IS_WINDOWS } from './const'
import { join } from 'path'
import { pendingPromise, Promisable } from './cross'
import { Stats, Dirent, Dir } from 'node:fs'
import events from './events'
import _ from 'lodash'
import { Context } from 'koa'
import fswin from 'fswin'
import { isDirectory } from './util-files'

export interface DirStreamEntry extends Dirent {
    closingBranch?: Promise<string>
    stats?: Stats
}

const dirQ = makeQ(3)

// cb returns void = just go on, null = stop, false = go on but don't recur (in case of depth)
export function walkDir(path: string, { depth = 0, hidden = true, ctx }: {
    depth?: number,
    hidden?: boolean,
    ctx?: Context
}, cb: (e: DirStreamEntry) => Promisable<void | null | false>) {
    let stopped = false
    const closingQ: string[] = []
    return new Promise(async (resolve, reject) => {
        if (!await isDirectory(path))
            return reject(Error('ENOTDIR'))
        dirQ.add(() => readDir('', depth)
            .then(res => { // don't make the job await for it, but use it to know it's over
                Promise.resolve(res?.branchDone).then(resolve)
            }, reject)
        )
    })

    async function readDir(relativePath: string, depth: number) {
        if (stopped) return
        const base = join(path, relativePath)
        const subDirsDone: Promise<any>[] = []
        let n = 0
        let last: DirStreamEntry | undefined

        const res = (await events.emitAsync('listDiskFolder', { path: base, ctx }))?.[0] // consider only first result
        const pluginReceiver = _.isFunction(res) && res || null
        const pluginIterator = _.isFunction(res?.[Symbol.asyncIterator] || res?.[Symbol.iterator]) && res as Dir

        if (IS_WINDOWS && !pluginIterator) { // use native apis to read the 'hidden' attribute
            const direntMethods = {
                isDir: false,
                isFile(){ return !this.isDir },
                isDirectory(){ return this.isDir },
                isBlockDevice(){ return false },
                isCharacterDevice() { return false },
            }
            await new Promise<void>(res => fswin.find(base + '\\*', (event, f) => {
                if (event !== 'FOUND') return res()
                if (stopped) return true // stop signal
                if (!hidden && f.IS_HIDDEN) return
                work(Object.assign(Object.create(direntMethods), {
                    isDir: f.IS_DIRECTORY,
                    name: f.LONG_NAME,
                    stats: { size: f.SIZE, birthtime: f.CREATION_TIME, mtime: f.LAST_WRITE_TIME } as Stats
                }))
            }, true))
        }
        else for await (let entry of (pluginIterator || await opendir(base))) {
            if (stopped) break
            if (!hidden && entry.name[0] === '.' && !IS_WINDOWS)
                continue
            const stats = entry.isSymbolicLink?.() && await stat(join(base, entry.name)).catch(() => null)
            if (stats === null) continue
            if (stats)
                entry = new DirentFromStats(entry.name, stats)
            const expanded: DirStreamEntry = entry
            if (stats)
                expanded.stats = stats
            await work(expanded)
        }
        pluginReceiver?.(!stopped)
        const branchDone = Promise.allSettled(subDirsDone)
        if (last) // using streams, we don't know when the entries are received, so we need to notify on last item
            last.closingBranch = branchDone.then(() => relativePath)
        else
            closingQ.push(relativePath) // ok, we'll ask next one to carry this info
        // don't return the promise directly, as this job ends here, but communicate to caller the promise for the whole branch
        return { branchDone, n }

        async function work(entry: DirStreamEntry) {
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
            const branchDone = pendingPromise() // per-job
            const job = () =>
                readDir(entry.path, depth - 1) // recur
                    .then(x => x, () => {}) // mute errors
                    .then(res => { // don't await, as readDir must resolve without branch being done
                        if (!res?.n)
                            closingQ.push(entry.path) // no children to tell i'm done
                        Promise.resolve(res?.branchDone).then(() =>
                            branchDone.resolve())
                    })
            dirQ.add(job) // this won't start until next tick
            subDirsDone.push(branchDone)
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
    if (name === 'constructor')
        continue;
    DirentFromStats.prototype[name] = function () {
        return this[kStats][name]();
    };
}
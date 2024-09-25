import { makeQ } from './makeQ'
import { stat, readdir } from 'fs/promises'
import { runCmd } from './util-os'
import { IS_WINDOWS } from './const'
import { join } from 'path'
import { Readable } from 'stream'
import { DAY, pendingPromise } from './cross'
import { Stats, Dirent } from 'node:fs'

export interface DirStreamEntry extends Dirent {
    closingBranch?: Promise<string>
    stats?: Stats
}

const dirQ = makeQ(3)

export function createDirStream(startPath: string, { depth=0, hidden=true }) {
    let stopped = false
    let started = false
    const closingQ: string[] = []
    const hiddenRoot = !hidden && IS_WINDOWS && getWindowsHiddenFiles(startPath) // produce first level faster
    const hiddenDeep = hiddenRoot && depth && getWindowsHiddenFiles(startPath, true)
    const stream = new Readable({
        objectMode: true,
        read() {
            if (started) return
            started = true
            dirQ.add(() => readDir('', depth)
                .then(res => { // don't make the job await for it, but use it to close the stream
                    Promise.resolve(res?.branchDone).then(() => {
                        stream.push(null)
                    })
                }, e => {
                    stream.emit('error', e)
                    return stream.push(null)
                })
            )
        }
    })
    stream.on('close', () => stopped = true)
    return Object.assign(stream, {
        stop() {
            stopped = true
            if (!dirQ.isWorking())
                stream.push(null)
        },
    })

    async function readDir(path: string, depth: number) {
        if (stopped) return
        const base = join(startPath, path)
        const subDirsDone: Promise<any>[] = []
        let last: DirStreamEntry | undefined = undefined
        let n = 0
        for await (let entry of await readdir(base, { withFileTypes: true })) {
            if (stopped) break
            if (!IS_WINDOWS && !hidden && entry.name[0] === '.')
                continue
            const stats = entry.isSymbolicLink() && await stat(join(base, entry.name)).catch(() => null)
            if (stats === null) continue
            if (stats)
                entry = new DirentFromStats(entry.name, stats)
            entry.path = (path && path + '/') + entry.name
            const hiddenFiles = await (path && hiddenDeep || hiddenRoot)
            if (hiddenFiles && hiddenFiles.includes(entry.path))
                continue
            if (last && closingQ.length) // pending entries
                last.closingBranch = Promise.resolve(closingQ.shift()!)
            last = entry
            const expanded: DirStreamEntry = entry
            if (stats)
                expanded.stats = stats
            if (depth > 0 && entry.isDirectory()) {
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
            stream.push(entry)
            n++
        }
        const branchDone = Promise.allSettled(subDirsDone).then(() => {})
        if (last) // using streams, we don't know when the entries are received, so we need to notify on last item
            last.closingBranch = branchDone.then(() => path)
        else
            closingQ.push(path) // ok, we'll ask next one to carry this info
        // don't return the promise directly, as this job ends here, but communicate to caller the promise for the whole branch
        return { branchDone, n }
    }
}

let lastNotice = 0
async function getWindowsHiddenFiles(path: string, depth=false) {
    const t = Date.now()
    const out = await runCmd('dir', ['/ah', '/b', depth ? '/s' : '/c', path.replaceAll('/', '\\')]) // cannot pass '', so we pass /c as a noop parameter
        .catch(()=>'') // error in case of no matching file
    const now = Date.now()
    if ((now - t) > 10_000 && (now - lastNotice) > DAY) {
        lastNotice = now
        console.log("A file list was heavily delayed. You can avoid this by enabling the option to show hidden files.")
    }
    const slice = !depth ? 0 : path.length + (path.at(-1) === '\\' ? 0 : 1)
    return out.trimEnd().split('\n').map(x => x.slice(slice).replaceAll('\\', '/'))
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
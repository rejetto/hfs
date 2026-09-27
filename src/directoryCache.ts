import { watch } from 'node:fs'
import type { FSWatcher, Stats } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { normalizeFilenameForPlatform } from './cross'
import { configReady, defineConfig, getConfig } from './config'
import { CFG } from './cross-const'
import { debounceAsync } from './debounceAsync'
import { onProcessExit, quitting } from './first'
import events from './events'
import { statWithTimeout } from './util-files'
import { DirentFromStats, walkDir } from './walkDir'
import { detectNetworkPaths } from './networkPaths'
import type { VfsNodeStored } from './vfs'

type CachedEntry = {
    name: string
    stats: Stats
    hidden: boolean
    isLink: boolean
}
type Session = {
    directories: Map<string, readonly CachedEntry[]>
    aliases: Map<string, string>
    aliasesByTarget: Map<string, Set<string>>
    unavailable: Set<string>
    failures: Set<string>
    dirty: Map<string, boolean>
    watchers: Map<string, FSWatcher>
    parents: Map<string, FSWatcher>
    watchRoots: Set<string>
    sources: string[]
    refreshAll: boolean
    run: () => Promise<void>
}

export const directoryCacheConfig = defineConfig<number>(CFG.directory_cache, 0)
let session: Session | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let networkPaths: string[] = []
let detecting: Promise<void> = Promise.resolve()
let configuring: Promise<void> = Promise.resolve()
let detectionId = 0
let detectionKey: string | undefined

export function initDirectoryCache() {
    const configure = debounceAsync(async () => {
        const value = directoryCacheConfig.get()
        const mode = [-1, 0, 1, 4, 24].includes(value) ? value : 0
        const sources = new Set<string>()
        if (mode && !quitting)
            collectSources(getConfig(CFG.vfs))
        const paths = [...sources].sort()
        const changed = !session || paths.join('\0') !== session.sources.join('\0')
        clearInterval(refreshTimer)
        if (!mode || quitting) {
            stopSession()
            session = undefined
        }
        else {
            if (changed) {
                const previous = session
                stopSession()
                const current: Session = {
                    directories: previous?.directories || new Map(),
                    aliases: previous?.aliases || new Map(),
                    aliasesByTarget: new Map(),
                    unavailable: new Set(previous?.unavailable),
                    failures: new Set(), dirty: new Map(),
                    watchers: new Map(), parents: new Map(), watchRoots: new Set(),
                    sources: paths, refreshAll: true,
                    run: debounceAsync(async () => run(current), { wait: 100, maxWait: 1000 }),
                }
                for (const [alias, target] of current.aliases)
                    addAliasTarget(current, alias, target)
                session = current
                void current.run()
            }
            if (mode > 0)
                refreshTimer = setInterval(refreshDirectoryCache, mode * 3600_000).unref()
        }
        const key = mode === -1 ? paths.join('\0') : undefined
        if (key !== detectionKey) {
            detectionKey = key
            const id = ++detectionId
            networkPaths = []
            // this advisory must not hold up configuration changes or filesystem scans
            detecting = mode === -1 ? detectNetworkPaths(paths).then(found => {
                if (id === detectionId)
                    networkPaths = found
            }, () => {}) : Promise.resolve()
        }

        function collectSources(node: VfsNodeStored | undefined) {
            if (!node) return
            if (node.source)
                sources.add(resolve(node.source))
            node.children?.forEach(collectSources)
        }
    })
    void configReady.then(() => {
        directoryCacheConfig.sub(scheduleConfiguration)
        events.on('config.' + CFG.vfs, scheduleConfiguration)
    })
    events.on('uploadFinished', ({ fullPath }: { fullPath: string }) => invalidateDirectoryCache(fullPath))
    onProcessExit(() => {
        clearInterval(refreshTimer)
        stopSession()
        session = undefined
    })

    function scheduleConfiguration() {
        configuring = configure()
    }
}

export async function getDirectoryCacheStatus() {
    await configuring
    await detecting
    return { enabled: Boolean(session), directories: session?.directories.size || 0, networkPaths }
}

export function refreshDirectoryCache() {
    if (!session) return
    session.refreshAll = true
    void session.run()
}

export function getCachedDirectory(path: string) {
    const current = session
    if (!current) return
    path = cachePath(current, path)
    if (current.unavailable.has(path) || !hasWatcherCoverage(current, path)) return
    // walkers enrich Dirent objects per request; the filesystem Stats object is the cached metadata
    return current.directories.get(path)?.map(entry => {
        return Object.assign(new DirentFromStats(entry.name, entry.stats), {
            stats: entry.stats, hidden: entry.hidden, isLink: entry.isLink,
        })
    })
}

export function getDirectoryCacheState(path: string) {
    const current = session
    if (!current) return
    path = cachePath(current, path)
    if (current.failures.has(path)) return false
    if (current.directories.has(path) && hasWatcherCoverage(current, path)) return true
}

export function invalidateDirectoryCache(...paths: string[]) {
    const current = session
    if (!current) return
    for (const path of paths) {
        let parent = cachePath(current, dirname(path))
        while (!current.directories.has(parent) && dirname(parent) !== parent)
            parent = dirname(parent)
        // HFS mutations must be visible before the asynchronous watcher catches up
        if (current.directories.has(parent)) {
            current.unavailable.add(parent)
            markDirty(current, parent, false)
        }
        const target = cachePath(current, path)
        if (current.directories.has(target)) {
            for (const directory of current.directories.keys())
                if (containsPath(target, directory))
                    current.unavailable.add(directory)
            markDirty(current, target, true)
        }
    }
    void current.run()
}

function stopSession() {
    if (!session) return
    for (const watcher of session.watchers.values())
        watcher.close()
    for (const watcher of session.parents.values())
        watcher.close()
}

function cachePath(current: Session, path: string) {
    path = normalizeCachePath(path)
    // aliases only contain resolved roots and symlinks; ordinary children share their physical snapshot
    const visited = new Set<string>()
    while (!visited.has(path)) {
        visited.add(path)
        let alias = path
        while (!current.aliases.has(alias)) {
            const parent = dirname(alias)
            if (parent === alias) return path
            alias = parent
        }
        path = normalizeCachePath(join(current.aliases.get(alias)!, relative(alias, path)))
    }
    return path
}

function normalizeCachePath(path: string) {
    path = resolve(path)
    return process.platform === 'win32' ? normalizeFilenameForPlatform(path, 'win32') : path
}

function containsPath(parent: string, path: string) {
    const rel = relative(parent, path)
    return rel === '' || rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)
}

async function run(current: Session) {
    // ponytail: sequential scans bound disk pressure; parallelize directories if startup becomes too slow
    while (session === current && !quitting && (current.refreshAll || current.dirty.size)) {
        const started = Date.now()
        const full = current.refreshAll
        current.refreshAll = false
        if (full)
            console.debug('directory cache: building')
        const jobs = full ? current.sources.map(path => [path, true] as const) : [...current.dirty]
        current.dirty.clear()
        const seen = new Set<string>()
        const roots = new Set<string>()
        for (const [path, recursive] of jobs) {
            if (session !== current || quitting) return
            await scan(path, recursive, full || current.watchRoots.has(path))
        }
        if (full && session === current) {
            for (const path of current.directories.keys())
                if (!seen.has(path)) {
                    current.directories.delete(path)
                    current.unavailable.delete(path)
                    current.failures.delete(path)
                }
            for (const [path, watcher] of current.watchers)
                if (!seen.has(path)) {
                    watcher.close()
                    current.watchers.delete(path)
                    current.watchRoots.delete(path)
                }
            for (const [path, watcher] of current.parents)
                if (!roots.has(path)) {
                    watcher.close()
                    current.parents.delete(path)
                }
            for (const path of current.aliases.keys())
                if (!roots.has(path))
                    deleteAlias(current, path)
            const entries = [...current.directories.values()].reduce((total, list) => total + list.length, 0)
            console.log(`directory cache: ready in ${((Date.now() - started) / 1000).toFixed(1)}s, ${entries.toLocaleString()} entries in ${current.directories.size.toLocaleString()} directories`)
        }

        async function scan(path: string, recursive: boolean, watchRoot=false) {
            if (session !== current || quitting) return
            path = normalizeCachePath(path)
            let watchable = true
            if (watchRoot) {
                const source = path
                try {
                    const physical = normalizeCachePath(await realpath(path))
                    const stats = await statWithTimeout(physical)
                    if (session !== current) return
                    if (!stats.isDirectory()) {
                        current.unavailable.delete(source)
                        current.failures.delete(source)
                        return
                    }
                    const previousTarget = current.aliases.get(path)
                    if (!full && previousTarget && previousTarget !== physical)
                        current.refreshAll = true
                    deleteAlias(current, path)
                    if (physical !== path)
                        setAlias(current, path, physical)
                    path = physical
                }
                catch {
                    path = cachePath(current, path)
                    current.watchers.get(path)?.close()
                    current.watchers.delete(path)
                    current.watchRoots.delete(path)
                    watchable = false
                }
                if (session !== current || quitting) return
                roots.add(source)
                roots.add(path)
                watchParent(current, source)
                if (watchable) {
                    watchParent(current, path)
                    ensureWatcher(current, path)
                }
            }
            if (seen.has(path)) return
            seen.add(path)
            const previous = current.directories.get(path)
            const entries: CachedEntry[] = []
            try {
                await walkDir(path, { diskOnly: true, hidden: true }, async entry => {
                    if (session !== current || quitting) return null
                    const stats = entry.stats || await statWithTimeout(join(path, entry.name))
                    entries.push({
                        name: entry.name, stats,
                        hidden: Boolean(entry.hidden), isLink: Boolean(entry.isLink),
                    })
                })
                if (session !== current || quitting) return
                // publish only complete directories; events arriving during the read remain queued for another pass
                current.directories.set(path, entries)
                current.failures.delete(path)
                if (!current.dirty.has(path)) {
                    if (hasWatcherCoverage(current, path))
                        current.unavailable.delete(path)
                    else
                        current.unavailable.add(path)
                }
            }
            catch {
                if (session !== current) return
                current.unavailable.add(path)
                current.failures.add(path)
                preserve(path)
                if (watchRoot && watchable) {
                    current.watchers.get(path)?.close()
                    current.watchers.delete(path)
                    ensureWatcher(current, path)
                }
                return
            }
            const names = new Set(entries.filter(isFolder).map(x => x.name))
            for (const entry of previous || [])
                if (isFolder(entry) && !names.has(entry.name)) {
                    const removed = join(path, entry.name)
                    if (entry.isLink)
                        current.refreshAll = true
                    deleteAlias(current, removed)
                    for (const key of current.directories.keys())
                        if (containsPath(removed, key)) {
                            current.directories.delete(key)
                            current.unavailable.delete(key)
                            current.failures.delete(key)
                        }
                }
            for (const entry of entries) {
                if (!isFolder(entry)) continue
                const child = join(path, entry.name)
                if (recursive || entry.isLink || !current.directories.has(cachePath(current, child)))
                    await scan(child, recursive, entry.isLink)
            }
        }

        function preserve(path: string) {
            // an unreachable source is not an empty directory; retain its last complete subtree
            for (const entry of current.directories.get(path) || []) {
                if (!isFolder(entry)) continue
                const child = cachePath(current, join(path, entry.name))
                if (entry.isLink) {
                    roots.add(join(path, entry.name))
                    roots.add(child)
                }
                if (seen.has(child)) continue
                seen.add(child)
                current.unavailable.add(child)
                preserve(child)
            }
        }
    }
}

function isFolder(entry: CachedEntry) {
    return entry.stats.isDirectory()
}

function markDirty(current: Session, path: string, recursive: boolean) {
    // a later file event must not downgrade an already queued subtree refresh
    path = cachePath(current, path)
    current.dirty.set(path, recursive || current.dirty.get(path) || false)
}

function hasWatcherCoverage(current: Session, path: string) {
    // every root needs both change and replacement observers before its snapshot is safe to serve
    let foundRoot = false
    let foundWatcher = false
    while (true) {
        if (current.watchRoots.has(path)) {
            foundRoot = true
            if (!hasParentWatcher(path)) return false
            for (const alias of current.aliasesByTarget.get(path) || [])
                if (!hasParentWatcher(alias)) return false
        }
        if (current.watchers.has(path))
            foundWatcher = true
        const parent = dirname(path)
        if (parent === path) break
        path = parent
    }
    return foundRoot && foundWatcher

    function hasParentWatcher(path: string) {
        return dirname(path) === path || current.parents.has(path)
    }
}

function setAlias(current: Session, alias: string, target: string) {
    deleteAlias(current, alias)
    current.aliases.set(alias, target)
    addAliasTarget(current, alias, target)
}

function addAliasTarget(current: Session, alias: string, target: string) {
    // keep watcher coverage lookup proportional to path depth instead of the total alias count
    const aliases = current.aliasesByTarget.get(target) || new Set<string>()
    aliases.add(alias)
    current.aliasesByTarget.set(target, aliases)
}

function deleteAlias(current: Session, alias: string) {
    const target = current.aliases.get(alias)
    if (!target) return
    current.aliases.delete(alias)
    const aliases = current.aliasesByTarget.get(target)
    aliases?.delete(alias)
    if (!aliases?.size)
        current.aliasesByTarget.delete(target)
}

function watchParent(current: Session, path: string) {
    path = normalizeCachePath(path)
    if (current.parents.has(path) || dirname(path) === path) return
    let parent = dirname(path)
    while (true)
        try {
            const child = normalizeCachePath(join(parent, relative(parent, path).split(sep)[0]!))
            // an available ancestor lets missing mount points and replaced roots rejoin the cache later
            const watcher = watch(parent, { persistent: false }, (event, filename) => {
                if (session !== current || event !== 'rename'
                    || filename && normalizeCachePath(join(parent, String(filename))) !== child) return
                watcher.close()
                current.parents.delete(path)
                const root = cachePath(current, path)
                current.watchers.get(root)?.close()
                current.watchers.delete(root)
                current.refreshAll = true
                void current.run()
            })
            watcher.on('error', () => {
                watcher.close()
                current.parents.delete(path)
            })
            current.parents.set(path, watcher)
            return
        }
        catch {
            const ancestor = dirname(parent)
            if (ancestor === parent) return
            parent = ancestor
        }
}

function ensureWatcher(current: Session, path: string) {
    path = normalizeCachePath(path)
    current.watchRoots.add(path)
    if ([...current.watchers.keys()].some(root => containsPath(root, path))) return
    try {
        const watcher = watch(path, { recursive: true, persistent: false }, (event, filename) => {
            if (session !== current) return
            if (filename) {
                const changed = normalizeCachePath(join(path, String(filename)))
                markDirty(current, dirname(changed), false)
                if (current.directories.has(changed))
                    markDirty(current, changed, event === 'rename')
            }
            else
                markDirty(current, path, true)
            void current.run()
        })
        watcher.on('error', () => {
            watcher.close()
            current.watchers.delete(path)
            current.unavailable.add(path)
            // retry on the next full refresh; immediate retries can loop on unsupported filesystems
        })
        current.watchers.set(path, watcher)
    }
    catch {}
}

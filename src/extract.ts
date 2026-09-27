import { createReadStream, createWriteStream } from 'fs'
import { access, lstat, mkdir, realpath, rm, stat } from 'fs/promises'
import { dirname, extname, join, posix, relative, win32 } from 'path'
import { randomUUID } from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import Koa from 'koa'
import unzipper from 'unzipper'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_FORBIDDEN, HTTP_INSUFFICIENT_STORAGE, HTTP_NOT_FOUND, UPLOAD_TEMP_PREFIX, ExtractionJob } from './cross-const'
import { hasDirTraversal, unzip } from './util-files'
import { applyParentToChild, getNodeByName, getVirtualName, hasPermission, nodeIsFolder, normalizeFilename, statusCodeForMissingPerm, urlToNode, VfsNodeWithPath } from './vfs'
import { apiAssertTypes } from './misc'
import { getCurrentUsername } from './auth'
import { ctxAdminAccess } from './adminApis'
import { hasUploadSpace, isUploading, publishUpload, whileUploadMetaPending } from './upload'
import { isWebdavLocked } from './webdav'
import { SendListReadable } from './SendList'
import { setUploadOwner } from './uploadOwners'
import { invalidateDirectoryCache } from './directoryCache'

interface ExtractEntry { path: string, size: number, stream: Readable }
interface ExtractCallbacks {
    space: (size: number) => void
    entry: (entry: ExtractEntry) => Promise<void>
    progress: (percent: number) => void
    invalid: (path: string) => void
}
type Extractor = (path: string, callbacks: ExtractCallbacks, signal: AbortSignal) => Promise<void>
const extractors = new Map<string, Extractor>([
    ['zip', async (path, callbacks, signal) => {
        const { size } = await stat(path)
        const directory = await unzipper.Open.file(path)
        const total = directory.files.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
        callbacks.space(Number.isFinite(total) ? total : size)
        signal.throwIfAborted()
        const stream = createReadStream(path, { signal })
        // attach after unzip has wired the parser, before the stream can start flowing
        const result = unzip(stream, path => path, {
            onInvalid: callbacks.invalid,
            async write(entry) {
                signal.throwIfAborted()
                if (entry.vars.flags & 1)
                    throw Error("Encrypted archives are not supported")
                // unzipper exposes this local-header field at runtime but omits it from its type declaration
                const vars = entry.vars as typeof entry.vars & { uncompressedSize?: number }
                await callbacks.entry({ path: entry.path, size: vars.uncompressedSize || 0, stream: entry })
            }
        })
        let read = 0
        stream.on('data', chunk => callbacks.progress(Math.floor((read += chunk.length) / size * 100)))
        try { await result }
        finally { stream.destroy() }
    }]
])

interface Job { data: ExtractionJob, source: string, controller: AbortController }
const jobs = new Map<string, Job>()
const listeners = new Set<() => void>()
const publishing = new Map<string, Promise<void>>()
function changed() { for (const notify of listeners) notify() }

export const extractionApis: ApiHandlers = {
    async extract_archive({ uri, dest = '' }, ctx) {
        apiAssertTypes({ string: { uri, dest } })
        if (hasDirTraversal(dest) || win32.isAbsolute(dest) || /^[a-z]:/i.test(dest))
            throw new ApiError(HTTP_BAD_REQUEST, "Invalid destination")
        const archive = await urlToNode(uri, ctx)
        if (!archive?.source || nodeIsFolder(archive))
            throw new ApiError(HTTP_NOT_FOUND)
        const denied = statusCodeForMissingPerm(archive, 'can_read', ctx)
            || statusCodeForMissingPerm(archive, 'can_see', ctx)
        if (denied) throw new ApiError(denied)
        const extractor = extractors.get(extname(archive.source).slice(1).toLowerCase())
        if (!extractor) throw new ApiError(HTTP_BAD_REQUEST, "Unsupported archive format")
        await access(archive.source)
        const source = await realpath(archive.source)
        const parent = archive.parent
        if (!parent?.source) throw new ApiError(HTTP_FORBIDDEN)
        const root = await realpath(parent.source)
        const destination = await folderAt(parent, dest.replaceAll('\\', '/'), root)
        await checkFolder(destination, true)
        if ([...jobs.values()].some(job => job.source === source && job.data.status === 'running'))
            throw new ApiError(HTTP_CONFLICT)
        const id = randomUUID()
        const job: Job = { source, controller: new AbortController(), data: {
            id, uri: archive.vfsPath, destination: destination.vfsPath.replace(/\/?$/, '/'),
            username: getCurrentUsername(ctx), progress: 0, status: 'running',
            entries: [], truncated: false, extracted: 0, skipped: 0,
        } }
        jobs.set(id, job)
        changed()
        void run()
        return { id }

        async function checkFolder(folder: VfsNodeWithPath, deleting = false) {
            const err = statusCodeForMissingPerm(folder, 'can_upload', ctx)
                // deleting children is the permission advertised by the file menu; explicit VFS folders themselves cannot be deleted
                || deleting && statusCodeForMissingPerm(applyParentToChild({ source: join(folder.source!, 'file'), original: undefined }, folder), 'can_delete', ctx)
            if (err) throw new ApiError(err)
            let ancestor = folder
            while (ancestor.parent && !await stat(ancestor.source!).catch(e => { if (e.code !== 'ENOENT') throw e }))
                ancestor = ancestor.parent
            if (ancestor !== folder) await checkFolder(ancestor, deleting)
        }

        async function run() {
            const { data, controller: { signal } } = job
            let lastFolder = '', folder = destination
            let remainingSize = 0
            console.debug("Extraction started:", source, "->", destination.source)
            try {
                await mkdir(destination.source!, { recursive: true })
                invalidateDirectoryCache(destination.source!)
                await extractor!(source, {
                    space(size) { remainingSize = size; checkSpace(size) },
                    progress(percent) { data.progress = percent },
                    invalid(path) { record(path, true) },
                    async entry({ path, size, stream }) {
                        signal.throwIfAborted()
                        const name = path.replaceAll('\\', '/')
                        const folderName = posix.dirname(name)
                        if (folderName !== lastFolder) {
                            folder = await folderAt(destination, folderName, root)
                            await checkFolder(folder)
                            lastFolder = folderName
                        }
                        const filename = posix.basename(name)
                        const target = join(folder.source!, filename)
                        const node = await getNodeByName(getVirtualName(filename, folder, target), folder)
                        if (!node?.source || relative(target, node.source) !== '')
                            throw new ApiError(HTTP_FORBIDDEN, "Destination does not match the shared path")
                        const existing = await lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e })
                        if (existing && !hasPermission(node, 'can_delete', ctx)
                        || isUploading(target) || isWebdavLocked(node.vfsPath, ctx)) {
                            record(path, true)
                            stream.resume()
                            return
                        }
                        // streaming ZIPs can omit local sizes, so reserve the remaining admitted total in that case
                        checkSpace(size || remainingSize)
                        await mkdir(folder.source!, { recursive: true })
                        invalidateDirectoryCache(folder.source!)
                        // each job writes to its own sibling, preserving the old file on failure and allowing atomic replacement
                        const temp = join(folder.source!, `${UPLOAD_TEMP_PREFIX}extract-${randomUUID()}`)
                        try {
                            await pipeline(stream, new Transform({
                                transform(chunk, _encoding, callback) {
                                    // size fields are untrusted; never write more than the space admitted for the archive
                                    if (chunk.length > remainingSize)
                                        return callback(Error("Archive exceeds its declared size"))
                                    remainingSize -= chunk.length
                                    callback(null, chunk)
                                },
                            }), createWriteStream(temp, { flags: 'wx' }), { signal })
                            signal.throwIfAborted()
                            const key = normalizeFilename(target)
                            // serialize only publication: metadata and ownership must describe the winning file, even with concurrent jobs
                            const publish = (publishing.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
                                signal.throwIfAborted()
                                const nowExists = await lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e })
                                if (nowExists && !hasPermission(node, 'can_delete', ctx)
                                || isUploading(target) || isWebdavLocked(node.vfsPath, ctx)) {
                                    record(path, true)
                                    return
                                }
                                await whileUploadMetaPending(target, async () => {
                                    await publishUpload(temp, target, { username: data.username || undefined, ip: ctx.ip, approved: ctxAdminAccess(ctx) || undefined })
                                    await setUploadOwner(node.vfsPath, ctx, target)
                                })
                                record(path, false)
                            })
                            publishing.set(key, publish)
                            try { await publish }
                            finally { if (publishing.get(key) === publish) publishing.delete(key) }
                        }
                        finally { await rm(temp, { force: true }) }
                    }
                }, signal)
                data.progress = 100
                data.status = 'done'
            }
            catch (e) {
                data.status = signal.aborted ? 'stopped' : 'error'
                if (!signal.aborted) data.error = e instanceof Error ? e.message : String(e)
            }
            finally {
                console.log(`Extraction ${data.status}: ${source} -> ${destination.source} (${data.extracted} extracted, ${data.skipped} skipped)`, data.error || '')
                changed()
                setTimeout(() => { jobs.delete(id); changed() }, 30 * 60_000).unref()
            }

            function checkSpace(size: number) {
                if (!hasUploadSpace(folder, size))
                    throw new ApiError(HTTP_INSUFFICIENT_STORAGE, "Not enough disk space")
            }
            function record(path: string, skipped: boolean) {
                data[skipped ? 'skipped' : 'extracted']++
                data.entries.push({ path, skipped })
                if (data.entries.length > 100) {
                    data.entries.shift()
                    data.truncated = true
                }
            }
        }
    },

    async get_extraction_progress({ uri }, ctx) {
        apiAssertTypes({ string: { uri } })
        const node = await urlToNode(uri, ctx)
        if (!node?.source) throw new ApiError(HTTP_NOT_FOUND)
        const denied = statusCodeForMissingPerm(node, 'can_see', ctx)
        if (denied) throw new ApiError(denied)
        const source = await realpath(node.source)
        return subscribe(() => {
            const job = [...jobs.values()].reverse().find(job => job.source === source)
            return { progress: job?.data.progress, status: job?.data.status }
        })
    },

    get_extractions({ ids = [] }, ctx) {
        if (typeof ids === 'string') {
            try { ids = JSON.parse(ids) }
            catch { throw new ApiError(HTTP_BAD_REQUEST) }
        }
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
            throw new ApiError(HTTP_BAD_REQUEST)
        return subscribe(() => ({ jobs: [...jobs.values()].filter(job => owns(job, ctx, ids)).map(job => ({ ...job.data,
            uri: publicUri(job.data.uri, ctx), destination: publicUri(job.data.destination, ctx),
        })) }))
    },

    stop_extraction({ id }, ctx) {
        apiAssertTypes({ string: { id } })
        const job = jobs.get(id)
        if (!job || !owns(job, ctx, [id])) throw new ApiError(HTTP_NOT_FOUND)
        job.controller.abort()
        return {}
    }
}

function owns(job: Job, ctx: Koa.Context, ids: string[]) {
    return ctxAdminAccess(ctx) || (job.data.username ? job.data.username === getCurrentUsername(ctx) : ids.includes(job.data.id))
}

function subscribe(snapshot: () => object) {
    const list = new SendListReadable()
    let previous = ''
    function send() {
        const value = snapshot()
        const json = JSON.stringify(value)
        if (json === previous) return
        previous = json
        list.props(JSON.parse(json)) // snapshot mutable jobs before SendList's buffered serialization
    }
    send()
    list.ready()
    listeners.add(send)
    const timer = setInterval(send, 500)
    list.once('close', () => { clearInterval(timer); listeners.delete(send) })
    return list
}

async function folderAt(base: VfsNodeWithPath, path: string, root: string) {
    let folder = base
    for (const name of path.split('/').filter(part => part && part !== '.')) {
        const source = join(folder.source!, name)
        const child = await getNodeByName(getVirtualName(name, folder, source), folder, true)
        if (!child?.source || relative(source, child.source) !== '' || !nodeIsFolder(child))
            throw new ApiError(HTTP_FORBIDDEN, "Invalid destination folder")
        folder = child
    }
    let existing = folder.source!
    while (true) {
        try {
            const actual = await realpath(existing)
            if (hasDirTraversal(relative(root, actual)) || win32.isAbsolute(relative(root, actual)))
                throw new ApiError(HTTP_FORBIDDEN, "Destination leaves the archive folder")
            break
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
            const parent = dirname(existing)
            if (parent === existing) throw e
            existing = parent
        }
    }
    return folder
}

function publicUri(path: string, ctx: Koa.Context) {
    const root = '/' + (ctx.state.root || '').replace(/^\/+|\/+$/g, '')
    const absolute = '/' + path.replace(/^\/+/, '')
    const local = root !== '/' && absolute.startsWith(root + '/') ? absolute.slice(root.length) : absolute
    return (ctx.state.revProxyPath || '') + local
}

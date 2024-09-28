// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { createReadStream, stat } from 'fs'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_NOT_FOUND, HTTP_NOT_MODIFIED,
    HTTP_OK, HTTP_PARTIAL_CONTENT, HTTP_RANGE_NOT_SATISFIABLE, HTTP_TOO_MANY_REQUESTS, MIME_AUTO } from './const'
import { getNodeName, VfsNode } from './vfs'
import mimetypes from 'mime-types'
import { defineConfig } from './config'
import { CFG, Dict, makeMatcher, matches, with_ } from './misc'
import _ from 'lodash'
import { basename } from 'path'
import { promisify } from 'util'
import { getConnection, updateConnection } from './connections'
import { getCurrentUsername } from './auth'
import { sendErrorPage } from './errorPages'
import { Readable } from 'stream'
import { createHash } from 'crypto'

const allowedReferer = defineConfig('allowed_referer', '')
const maxDownloads = downloadLimiter(defineConfig(CFG.max_downloads, 0), () => true)
const maxDownloadsPerIp = downloadLimiter(defineConfig(CFG.max_downloads_per_ip, 0), ctx => ctx.ip)
const maxDownloadsPerAccount = downloadLimiter(defineConfig(CFG.max_downloads_per_account, 0), ctx => getCurrentUsername(ctx) || undefined)

export async function serveFileNode(ctx: Koa.Context, node: VfsNode) {
    const { source, mime } = node
    const name = getNodeName(node)
    const mimeString = typeof mime === 'string' ? mime
        : _.find(mime, (val,mask) => matches(name, mask))
    if (allowedReferer.get()) {
        const ref = /\/\/([^:/]+)/.exec(ctx.get('referer'))?.[1] // extract host from url
        if (ref && ref !== host() // automatically accept if referer is basically the hosting domain
        && !matches(ref, allowedReferer.get()))
            return ctx.status = HTTP_FORBIDDEN
    }

    ctx.vfsNode = // legacy pre-0.51 (download-quota)
    ctx.state.vfsNode = node // useful to tell service files from files shared by the user
    if ('dl' in ctx.query) // please, download
        ctx.attachment(name)
    else if (ctx.get('referer')?.endsWith('/') && with_(ctx.get('accept'), x => x && !x.includes('text')))
        ctx.state.considerAsGui = true
    await serveFile(ctx, source||'', mimeString)

    if (await maxDownloadsPerAccount(ctx) === undefined) // returning false will not execute other limits
        await maxDownloads(ctx) || await maxDownloadsPerIp(ctx)

    function host() {
        const s = ctx.host
        return s[0] === '[' ? s.slice(1, s.indexOf(']')) : s?.split(':')[0]
    }
}

const mimeCfg = defineConfig<Dict<string>, (name: string) => string | undefined>('mime', { '*': MIME_AUTO }, obj => {
    const matchers = Object.keys(obj).map(k => makeMatcher(k))
    const values = Object.values(obj)
    return (name: string) => values[matchers.findIndex(matcher => matcher(name))]
})

// after this number of seconds, the browser should check the server to see if there's a newer version of the file
const cacheControlDiskFiles = defineConfig('cache_control_disk_files', 5)

export async function serveFile(ctx: Koa.Context, source:string, mime?:string, content?: string | Buffer) {
    if (!source)
        return
    const fn = basename(source)
    mime = mime ?? mimeCfg.compiled()(fn)
    if (!mime || mime === MIME_AUTO)
        mime = mimetypes.lookup(source) || ''
    if (mime)
        ctx.type = mime
    if (ctx.method === 'OPTIONS') {
        ctx.status = HTTP_NO_CONTENT
        ctx.set({ Allow: 'OPTIONS, GET, HEAD' })
        return
    }
    if (ctx.method !== 'GET')
        return ctx.status = HTTP_METHOD_NOT_ALLOWED
    try {
        const stats = await promisify(stat)(source) // using fs's function instead of fs/promises, because only the former is supported by pkg
        if (!stats.isFile())
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        const t = stats.mtime.toUTCString()
        ctx.set('Last-Modified', t)
        ctx.set('Etag', createHash('md5').update(source).update(t).digest('hex'))
        ctx.state.fileSource = source
        ctx.state.fileStats = stats
        ctx.status = HTTP_OK
        if (ctx.fresh)
            return ctx.status = HTTP_NOT_MODIFIED
        if (content !== undefined)
            return ctx.body = content
        const cc = cacheControlDiskFiles.get()
        if (_.isNumber(cc))
            ctx.set('Cache-Control', `max-age=${cc}`)
        const { size } = stats
        const range = applyRange(ctx, size)
        ctx.body = createReadStream(source, range)
        if (ctx.state.vfsNode)
            monitorAsDownload(ctx, size, range?.start)
    }
    catch (e: any) {
        return ctx.status = HTTP_NOT_FOUND
    }
}

export function monitorAsDownload(ctx: Koa.Context, size?: number, offset?: number) {
    if (!(ctx.body instanceof Readable))
        throw 'incompatible body'
    const conn = getConnection(ctx)
    ctx.body.on('end', () =>
        updateConnection(conn, {}, { opProgress: 1 }) )
    updateConnection(conn, {}, {
        opProgress: 0,
        opTotal: size,
        opOffset: size && offset && (offset / size),
    })
}

export function applyRange(ctx: Koa.Context, totalSize=ctx.response.length) {
    ctx.set('Accept-Ranges', 'bytes')
    const { range } = ctx.request.header
    if (!range) {
        ctx.state.includesLastByte = true
        ctx.response.length = totalSize
        return
    }
    const [unit, ranges] = range.split('=')
    if (unit !== 'bytes')
        return ctx.throw(HTTP_BAD_REQUEST, 'bad range unit')
    if (ranges?.includes(','))
        return ctx.throw(HTTP_BAD_REQUEST, 'multi-range not supported')
    let bytes = ranges?.split('-')
    if (!bytes?.length)
        return ctx.throw(HTTP_BAD_REQUEST, 'bad range')
    const max = totalSize - 1
    const start = bytes[0] ? Number(bytes[0]) : Math.max(0, totalSize-Number(bytes[1])) // a negative start is relative to the end
    const end = (bytes[0] && bytes[1]) ? Math.min(max, Number(bytes[1])) : max
    // we don't support last-bytes without knowing max
    if (isNaN(end) && isNaN(max) || end > max || start > max) {
        ctx.status = HTTP_RANGE_NOT_SATISFIABLE
        ctx.set('Content-Range', `bytes ${totalSize}`)
        ctx.body = 'Requested Range Not Satisfiable'
        return
    }
    ctx.state.includesLastByte = end === max
    ctx.status = HTTP_PARTIAL_CONTENT
    ctx.set('Content-Range', `bytes ${start}-${isNaN(end) ? '' : end}/${isNaN(totalSize) ? '*' : totalSize}`)
    ctx.response.length = end - start + 1
    return { start, end }
}

declare module "koa" {
    interface DefaultState {
        vfsNode?: VfsNode
        includesLastByte?: boolean
    }
}
function downloadLimiter<T>(configMax: { get: () => number | undefined }, cbKey: (ctx: Koa.Context) => T | undefined) {
    const map = new Map<T, number>()
    return (ctx: Koa.Context) => {
        if (!ctx.body || ctx.state.considerAsGui) return // !body = no file sent, cache hit
        const k = cbKey(ctx)
        if (k === undefined) return // undefined = skip limit
        const max = configMax.get()
        const now = map.get(k) || 0
        if (max && now >= max)
            return tooMany()
        map.set(k, now + 1)
        ctx.req.on('close', () => {
            const n = map.get(k)!
            if (n > 1)
                map.set(k, n - 1)
            else
                map.delete(k)
        })
        return false // limit is enforced but passed

        async function tooMany() {
            ctx.set('retry-after', '60')
            await sendErrorPage(ctx, HTTP_TOO_MANY_REQUESTS)
            return true
        }
    }
}

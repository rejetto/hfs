// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { createReadStream, stat } from 'fs'
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_NOT_FOUND, HTTP_NOT_MODIFIED,
    HTTP_OK, HTTP_PARTIAL_CONTENT, HTTP_RANGE_NOT_SATISFIABLE, MIME_AUTO } from './const'
import { getNodeName, VfsNode } from './vfs'
import mimetypes from 'mime-types'
import { defineConfig } from './config'
import { matches } from './misc'
import _ from 'lodash'
import path from 'path'
import { promisify } from 'util'
import { updateConnection } from './connections'

const allowedReferer = defineConfig('allowed_referer', '')

export function serveFileNode(ctx: Koa.Context, node: VfsNode) {
    const { source, mime } = node
    const name = getNodeName(node)
    const mimeString = typeof mime === 'string' ? mime
        : _.find(mime, (val,mask) => matches(name, mask))
    if (allowedReferer.get()) {
        const ref = /\/\/([^:/]+)/.exec(ctx.get('referer'))?.[1] // extract host from url
        if (ref && ref !== host() // automatic accept if referer is basically the hosting domain
        && !matches(ref, allowedReferer.get()))
            return ctx.status = HTTP_FORBIDDEN
    }

    ctx.vfsNode = node // useful to tell service files from files shared by the user
    if ('dl' in ctx.query) // please, download
        ctx.attachment(name)
    return serveFile(ctx, source||'', mimeString)

    function host() {
        const s = ctx.get('host')
        return s[0] === '[' ? s.slice(1, s.indexOf(']')) : s?.split(':')[0]
    }
}

const mimeCfg = defineConfig<Record<string,string>>('mime', { '*': MIME_AUTO })

export async function serveFile(ctx: Koa.Context, source:string, mime?:string, content?: string | Buffer) {
    if (!source)
        return
    const fn = path.basename(source)
    mime = mime ?? _.find(mimeCfg.get(), (v,k) => matches(fn, k))
    if (mime === MIME_AUTO)
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
        ctx.set('Last-Modified', stats.mtime.toUTCString())
        ctx.fileSource = source
        ctx.fileStats = stats
        ctx.status = HTTP_OK
        if (ctx.fresh)
            return ctx.status = HTTP_NOT_MODIFIED
        if (content !== undefined)
            return ctx.body = content
        const { size } = stats
        const range = getRange(ctx, size)
        ctx.body = createReadStream(source, range).on('end', () =>
            updateConnection(ctx.state.connection, { opProgress: 1 }) )
        if (ctx.vfsNode)
            updateConnection(ctx.state.connection, {
                ctx, // this will cause 'path' to be sent as well
                op: 'download',
                opTotal: stats.size,
                opOffset: range && (range.start / size),
            })
    }
    catch (e: any) {
        return ctx.status = HTTP_NOT_FOUND
    }
}

export function getRange(ctx: Koa.Context, totalSize: number) {
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
    const end = bytes[0] ? Number(bytes[1] || max) : max
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

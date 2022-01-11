import Koa from 'koa'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { METHOD_NOT_ALLOWED, NO_CONTENT } from './const'
import { MIME_AUTO, VfsNode } from './vfs'
import mimetypes from 'mime-types'
import { getConfig } from './config'
import mm from 'micromatch'
import _ from 'lodash'
import path from 'path'

export function serveFileNode(node: VfsNode) : Koa.Middleware {
    const { source, mime } = node
    return serveFile(source||'', mime)
}

export function serveFile(source:string, mime?:string) : Koa.Middleware {
    return async (ctx) => {
        if (!source)
            return
        const { range } = ctx.request.header
        ctx.set('Accept-Ranges', 'bytes')
        const mimeCfg = getConfig('mime')
        const fn = path.basename(source)
        mime = mime ?? _.find(mimeCfg, (v,k) => mm.isMatch(fn, k))
        if (mime === MIME_AUTO)
            mime = mimetypes.lookup(source) || ''
        if (mime)
            ctx.type = mime
        if (ctx.method === 'OPTIONS') {
            ctx.status = NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = METHOD_NOT_ALLOWED
        const stats = await fs.stat(source)
        ctx.set('Last-Modified', stats.mtime.toUTCString())
        ctx.fileSource = source
        ctx.status = 200
        if (ctx.fresh)
            return ctx.status = 304
        if (!range)
            return ctx.body = createReadStream(source)
        const ranges = range.split('=')[1]
        if (ranges.includes(','))
            return ctx.throw(400, 'multi-range not supported')
        let bytes = ranges?.split('-')
        if (!bytes?.length)
            return ctx.throw(400, 'bad range')
        const max = stats.size - 1
        let start = Number(bytes[0])
        let end = Number(bytes[1]) || max
        if (end > max || start > max) {
            ctx.status = 416
            ctx.set('Content-Range', `bytes ${stats.size}`)
            ctx.body = 'Requested Range Not Satisfiable'
            return
        }
        ctx.status = 206
        ctx.set('Content-Range', `bytes ${start}-${end}/${stats.size}`)
        ctx.body = createReadStream(source, { start, end })
    }
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import Koa from 'koa'
import { createReadStream, stat } from 'fs'
import fs from 'fs/promises'
import { FORBIDDEN, METHOD_NOT_ALLOWED, NO_CONTENT } from './const'
import { getNodeName, MIME_AUTO, VfsNode } from './vfs'
import mimetypes from 'mime-types'
import { defineConfig } from './config'
import mm, { isMatch } from 'micromatch'
import _ from 'lodash'
import path from 'path'
import { promisify } from 'util'
import { updateConnection } from './connections'

const allowedReferer = defineConfig('allowed_referer')

export function serveFileNode(node: VfsNode) : Koa.Middleware {
    const { source, mime } = node
    const name = getNodeName(node)
    const mimeString = typeof mime === 'string' ? mime
        : _.find(mime, (val,mask) => isMatch(name, mask))
    return (ctx, next) => {
       const allowed = allowedReferer.get()
        if (allowed) {
            const ref = /\/\/([^:/]+)/.exec(ctx.get('referer'))?.[1] // extract host from url
            if (ref && ref !== host() // automatic accept if referer is basically the hosting domain
            && !isMatch(ref, allowed))
                return ctx.status = FORBIDDEN

            function host() {
                const s = ctx.get('host')
                return s[0] === '[' ? s.slice(1, s.indexOf(']')) : s?.split(':')[0]
            }
        }

        ctx.vfsNode = node // useful to tell service files from files shared by the user
        return serveFile(source||'', mimeString)(ctx, next)
    }
}

const mimeCfg = defineConfig('mime', { '*.jpg|*.png|*.mp3|*.txt': 'auto' })

export function serveFile(source:string, mime?:string, modifier?:(s:string)=>string) : Koa.Middleware {
    return async (ctx) => {
        if (!source)
            return
        const { range } = ctx.request.header
        ctx.set('Accept-Ranges', 'bytes')
        const fn = path.basename(source)
        mime = mime ?? _.find(mimeCfg.get(), (v,k) => k && mm.isMatch(fn, k))
        if (mime === MIME_AUTO)
            mime = mimetypes.lookup(source) || ''
        if (mime)
            ctx.type = mime
        if (ctx.method === 'OPTIONS') {
            ctx.status = NO_CONTENT
            ctx.set({ Allow: 'OPTIONS, GET, HEAD' })
            return
        }
        if (ctx.method !== 'GET')
            return ctx.status = METHOD_NOT_ALLOWED
        try {
            const stats = await promisify(stat)(source) // using fs's function instead of fs/promises, because only the former is supported by pkg
            ctx.set('Last-Modified', stats.mtime.toUTCString())
            ctx.fileSource = source
            ctx.status = 200
            if (ctx.fresh)
                return ctx.status = 304

            const conn = ctx.state.connection
            if (conn)
                updateConnection(conn, { ctx }) // fileSource is affecting connection's outputted data, so we request an update
            if (modifier)
                return ctx.body = modifier(String(await fs.readFile(source)))
            if (!range) {
                ctx.body = createReadStream(source)
                ctx.response.length = stats.size
                return
            }
            const ranges = range.split('=')[1]
            if (ranges.includes(','))
                return ctx.throw(400, 'multi-range not supported')
            let bytes = ranges?.split('-')
            if (!bytes?.length)
                return ctx.throw(400, 'bad range')
            const max = stats.size - 1
            let start = Number(bytes[0]) || 0
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
            ctx.response.length = end - start + 1
        }
        catch {
            return ctx.status = 404
        }
    }
}

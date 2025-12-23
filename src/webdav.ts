import Koa from 'koa'
import {
    getNodeName, nodeIsFolder, nodeIsLink, nodeStats, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode
} from './vfs'
import {
    HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED, HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED,
    enforceFinal, pathEncode, prefix, getOrSet, Dict, Timeout, CFG
} from './cross'
import { PassThrough } from 'stream'
import { mkdir, rm } from 'fs/promises'
import { isValidFileName } from './misc'
import { basename, dirname, join } from 'path'
import { requestedRename } from './frontEndApis'
import { exec } from 'child_process'
import { getCurrentUsername } from './auth'
import { defineConfig } from './config'

const forceWebdavLogin = defineConfig(CFG.force_webdav_login, false)

const canOverwrite = new Set()

export async function handledWebdav(ctx: Koa.Context) {
    const {path} = ctx

    if (ctx.method === 'OPTIONS') {
        if (ctx.get('Access-Control-Request-Method')) return // it's a preflight cors request, not webdav
        setWebdavHeaders()
        if (forceWebdavLogin.get() && !getCurrentUsername(ctx)) {
            ctx.status = HTTP_UNAUTHORIZED
            return true
        }
        ctx.body = ''
        return true
    }
    if (ctx.method === 'PUT') {
        // Finder first creates an empty file, probably to test if upload is possible, the wants to overwrite it.
        // You may not have permission for deletion, and uploads get renamed, so we give it special permission for a few seconds.
        const x = ctx.get('x-expected-entity-length') // field used by Finder's webdav on actual upload, after
        if (!x && !ctx.length) {
            canOverwrite.add(path)
            setTimeout(() => canOverwrite.delete(path), 10_000) // grace period
        }
        else if (canOverwrite.has(path)) {
            canOverwrite.delete(path)
            const node = await urlToNode(path, ctx)
            if (node?.source)
                await rm(node.source).catch(() => {})
        }
        if (x && ctx.length === undefined) // missing length can make PUT fail
            ctx.req.headers['content-length'] = x
        return // default handling
    }
    if (ctx.method === 'MKCOL') {
        setWebdavHeaders()
        const node = await urlToNode(path, ctx)
        if (node)
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        let name = ''
        const parentNode = await urlToNode(path, ctx, vfs, v => name = v)
        if (!parentNode)
            return ctx.status = HTTP_NOT_FOUND
        if (!isValidFileName(name))
            return ctx.status = HTTP_BAD_REQUEST
        if (statusCodeForMissingPerm(parentNode, 'can_upload', ctx))
            return true
        try {
            await mkdir(join(parentNode.source!, name))
            return ctx.status = HTTP_CREATED
        }
        catch(e:any) {
            return ctx.status = HTTP_SERVER_ERROR
        }
    }
    if (ctx.method === 'MOVE') {
        setWebdavHeaders()
        const node = await urlToNode(path, ctx)
        if (!node) return
        let dest = ctx.get('destination')
        const i = dest.indexOf('//')
        if (i >= 0)
            dest = dest.slice(dest.indexOf('/', i + 2))
        if (dirname(path) === dirname(dest)) // rename
            try {
                await requestedRename(node, basename(decodeURI(dest)), ctx)
                return ctx.status = HTTP_CREATED
            }
            catch(e:any) {
                return ctx.status = e.status || HTTP_SERVER_ERROR
            }
        return
    }
    if (ctx.method === 'PROPFIND') {
        setWebdavHeaders()
        const node = await urlToNode(path, ctx)
        if (!node) return
        let depth = Number(ctx.get('depth'))
        depth = isNaN(depth) ? Infinity : depth
        const isList = depth !== 0
        if (statusCodeForMissingPerm(node, isList ? 'can_list' : 'can_see', ctx))
            return true
        ctx.type = 'xml'
        ctx.status = 207
        const pathSlash = enforceFinal('/', path)
        const res = ctx.body = new PassThrough({ encoding: 'utf8' })
        res.write(`<?xml version="1.0" encoding="utf-8" ?><multistatus xmlns="DAV:">`)
        await sendEntry(node)
        if (isList) {
            depth = Math.max(0, depth - 1)
            for await (const n of walkNode(node, { ctx, depth }))
                await sendEntry(n, true)
        }
        res.write(`</multistatus>`)
        res.end()
        return true

        async function sendEntry(node: VfsNode, append=false) {
            if (nodeIsLink(node)) return
            const name = getNodeName(node)
            const isDir = await nodeIsFolder(node)
            const st = await nodeStats(node)
            res.write(`<response>
              <href>${pathSlash + (append ? pathEncode(name, true) + (isDir ? '/' : '') : '')}</href>
              <propstat>
                <status>HTTP/1.1 200 OK</status>
                <prop>
                    ${prefix('<getlastmodified>', (st?.mtime as any)?.toGMTString(), '</getlastmodified>')}
                    ${prefix('<creationdate>', (st?.birthtime || st?.ctime)?.toISOString().replace(/\..*/, '-00:00'), '</creationdate>')}
                    ${isDir ? '<resourcetype><collection/></resourcetype>'
                : `<resourcetype/><getcontentlength>${st?.size}</getcontentlength>`}
                </prop>
              </propstat>
              </response>
            `)
        }
    }

    function setWebdavHeaders() {
        ctx.set('DAV', '1')
        ctx.set('Allow', 'PROPFIND,OPTIONS,DELETE,MOVE,MKCOL,PUT')
        ctx.set('WWW-Authenticate', `Basic realm="${pathEncode(path)}"`) //TODO only if 401
    }

}

// Finder will upload special attributes as files with name ._* that can be merged using system utility "dot_clean"
const cleaners: Dict<Timeout> = {}
function dotClean(path: string) {
    getOrSet(cleaners, path, () => setTimeout(() => {
        try { exec('dot_clean .', { cwd: path }, (err, out) => done(err || out)) }
        catch (e) { done(e) }

        function done(log: any) {
            console.debug('dot_clean', path, log)
            delete cleaners[path]
        }
    }, 10_000))
}
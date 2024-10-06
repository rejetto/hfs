import Koa from 'koa'
import {
    getNodeName, nodeIsFolder, nodeIsLink, nodeStats, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode
} from './vfs'
import {
    HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_NOT_FOUND, HTTP_SERVER_ERROR,
    enforceFinal, pathEncode, prefix, getOrSet, Dict, Timeout, HTTP_UNAUTHORIZED, CFG, HTTP_LOCKED, HTTP_FORBIDDEN, DAY
} from './cross'
import { PassThrough } from 'stream'
import { mkdir, rm } from 'fs/promises'
import { isValidFileName } from './misc'
import { basename, dirname, join } from 'path'
import { moveFiles, requestedRename } from './frontEndApis'
import { randomUUID } from 'node:crypto'
import { IS_MAC } from './const'
import { exec } from 'child_process'
import { getCurrentUsername } from './auth'
import { defineConfig } from './config'
import { expiringCache } from './expiringCache'

const forceWebdavLogin = defineConfig<boolean|string, null|RegExp>(CFG.force_webdav_login, true, compileWebdavAgentRegex)
const webdavInitialAuth = defineConfig<boolean|string, null|RegExp>(CFG.webdav_initial_auth, 'WebDAVFS', compileWebdavAgentRegex)
const webdavPrompted = expiringCache<boolean>(DAY)
const webdavDetectedAgents = new Set<string>()

const TOKEN_HEADER = 'lock-token'
const WEBDAV_METHODS = new Set(['PROPFIND', 'PROPPATCH', 'MKCOL', 'MOVE', 'LOCK', 'UNLOCK'])
const WEBDAV_HINT_HEADERS = ['depth', 'destination', 'overwrite', 'translate', 'if', TOKEN_HEADER, 'x-expected-entity-length']
const KNOWN_UA = /webdav|miniredir|davclnt/i

const canOverwrite = new Set()
const locks = new Map<string, { token: string, timeout: NodeJS.Timeout }>()

function isLocked(path: string, ctx: Koa.Context) {
    const lock = locks.get(path)
    if (!lock) return false
    const ifHeader = ctx.get('If')
    const tokenHeader = ctx.get(TOKEN_HEADER)
    if (hasToken(ifHeader, lock.token) || hasToken(tokenHeader, lock.token))
        return false
    ctx.status = HTTP_LOCKED
    return true
}

function hasToken(header: string, token: string) {
    if (!header) return false
    return header.includes(`<${token}>`) || header.split(/[,;\s]+/).includes(token)
}

export async function handledWebdav(ctx: Koa.Context) {
    const {path} = ctx
    const isWebdavAuthRequest = WEBDAV_METHODS.has(ctx.method) || WEBDAV_HINT_HEADERS.some(h => !!ctx.get(h))
    const ua = ctx.get('user-agent')
    if (isWebdavAuthRequest && getCurrentUsername(ctx)) {
        if (ua)
            webdavDetectedAgents.add(ua)
    }

    if (ctx.path.includes('/._') && ua?.startsWith('WebDAVFS')) {// too much spam from Finder for these files that can contain metas
        ctx.state.dontLog = true
        return ctx.status = HTTP_FORBIDDEN
    }
    if (ctx.method === 'OPTIONS') {
        if (ctx.get('Access-Control-Request-Method')) return // it's a preflight cors request, not webdav
        setWebdavHeaders()
        ctx.body = ''
        return true
    }
    if (isWebdavAuthRequest && shouldChallengeWebdav())
        return true
    if (ctx.method === 'PUT') {
        if (isLocked(path, ctx)) return true
        // Finder first creates an empty file (a test?) then wants to overwrite it, which requires deletion permission, but the user may not have it, causing a renamed upload. To solve, so we give it special permission for a few seconds.
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

        if (KNOWN_UA.test(ua) || webdavDetectedAgents.has(ua))
            ctx.query.existing ??= 'overwrite' // with webdav this is our default
        return // default handling
    }
    if (ctx.method === 'MKCOL') {
        setWebdavHeaders()
        if (isLocked(path, ctx)) return true
        const node = await urlToNode(path, ctx)
        if (node)
            return ctx.status = HTTP_METHOD_NOT_ALLOWED
        let name = ''
        const parentNode = await urlToNode(path, ctx, vfs, v => name = v)
        if (!parentNode)
            return ctx.status = HTTP_NOT_FOUND
        if (!isValidFileName(name))
            return ctx.status = HTTP_BAD_REQUEST
        if (statusCodeForMissingPerm(parentNode, 'can_upload', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return true
        }
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
        if (isLocked(path, ctx)) return true
        const node = await urlToNode(path, ctx)
        if (!node) return
        let dest = ctx.get('destination')
        const i = dest.indexOf('//')
        if (i >= 0)
            dest = dest.slice(dest.indexOf('/', i + 2))
        if (isLocked(dest, ctx)) return true
        if (dirname(path) === dirname(dest)) // rename. `path` is is encoded, so we test before decoding `dest`
            try {
                await requestedRename(node, basename(decodeURI(dest)), ctx)
                return ctx.status = HTTP_CREATED
            }
            catch(e:any) {
                return ctx.status = e.status || HTTP_SERVER_ERROR
            }
        const moveRes = await moveFiles([path], dirname(dest), ctx)
        if (moveRes instanceof Error)
            return ctx.status = (moveRes as any).status || HTTP_SERVER_ERROR
        const err = moveRes?.errors?.[0]
        return ctx.status = !err ? HTTP_CREATED : typeof err === 'number' ? err : HTTP_SERVER_ERROR
    }
    if (ctx.method === 'DELETE') {
        setWebdavHeaders()
        if (isLocked(path, ctx)) return true
        return // allow default handling in serveGuiAndSharedFiles.ts
    }
    if (ctx.method === 'UNLOCK') {
        setWebdavHeaders()
        const x = ctx.get(TOKEN_HEADER).slice(1,-1)
        const lock = locks.get(path)
        if (x !== lock?.token)
            return ctx.status = HTTP_BAD_REQUEST
        clearTimeout(lock.timeout)
        locks.delete(path)
        ctx.set(TOKEN_HEADER, x)
        if (IS_MAC)
            urlToNode(path, ctx).then(x => x?.source && dotClean(dirname(x.source)))
        return ctx.status = HTTP_NO_CONTENT
    }
    if (ctx.method === 'LOCK') {
        setWebdavHeaders()
        if (locks.has(path))
            return ctx.status = 423
        const token = 'urn:uuid:' + randomUUID()
        ctx.set(TOKEN_HEADER, token)
        const seconds = 3600
        const timeout = setTimeout(() => locks.delete(path), seconds * 1000)
        locks.set(path, { token, timeout })
        ctx.body = `<?xml version="1.0" encoding="utf-8"?><prop xmlns="DAV:"><lockdiscovery><activelock>
            <locktype><write/></locktype>
            <lockscope><exclusive/></lockscope>
            <locktoken><href>${token}</href></locktoken>
            <lockroot><href>${path}</href></lockroot>
            <depth>0</depth>
            <timeout>Second-${seconds}</timeout>
        </activelock></lockdiscovery></prop>`
        return true
    }
    if (ctx.method === 'PROPFIND') {
        setWebdavHeaders()
        const node = await urlToNode(path, ctx)
        if (!node) return
        let depth = Number(ctx.get('depth'))
        depth = isNaN(depth) ? Infinity : depth
        const isList = depth !== 0
        if (statusCodeForMissingPerm(node, isList ? 'can_list' : 'can_see', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return true
        }
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
    if (ctx.method === 'PROPPATCH') {
        setWebdavHeaders()
        if (isLocked(path, ctx)) return true
        const node = await urlToNode(path, ctx)
        if (!node) return
        if (statusCodeForMissingPerm(node, 'can_see', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return true
        }
        ctx.type = 'xml'
        ctx.status = 207
        ctx.body = `<?xml version="1.0" encoding="utf-8"?>
            <multistatus xmlns="DAV:">
              <response>
                <href>${path}</href>
                <propstat>
                  <status>HTTP/1.1 200 OK</status>
                  <prop/>
                </propstat>
              </response>
            </multistatus>`
        return true
    }

    function setWebdavHeaders(authenticate=false) {
        ctx.set('DAV', '1,2')
        ctx.set('MS-Author-Via', 'DAV')
        ctx.set('Allow', 'PROPFIND,PROPPATCH,OPTIONS,DELETE,MOVE,LOCK,UNLOCK,MKCOL,PUT')
        if (authenticate)
            ctx.set('WWW-Authenticate', `Basic realm="HFS WebDAV"`) // keep a dedicated realm for WebDAV so Windows credential cache is isolated from other basic-auth flows
    }

    function shouldChallengeWebdav() {
        if (getCurrentUsername(ctx))
            return false
        if (forceWebdavLogin.compiled()?.test(ua))
            return challengeWebdav()
        if (!webdavInitialAuth.compiled()?.test(ua))
            return false
        if (ctx.get('authorization'))
            return challengeWebdav()
        const key = `${ctx.ip}|${ctx.host}|${ua || ''}`
        if (webdavPrompted.has(key))
            return false
        webdavPrompted.try(key, () => true)
        return challengeWebdav()

        function challengeWebdav() {
            setWebdavHeaders(true)
            ctx.status = HTTP_UNAUTHORIZED
            ctx.body = ''
            return true
        }
    }

}

function compileWebdavAgentRegex(v: boolean|string) {
    return !v ? null : v === true ? /.*/ : new RegExp(v.trim(), 'i')
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

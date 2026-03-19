import Koa from 'koa'
import { text as stream2string } from 'node:stream/consumers'
import {
    getNodeName, nodeIsFolder, nodeIsLink, nodeStats, statusCodeForMissingPerm, urlToNode, vfs, VfsNode, walkNode
} from './vfs'
import {
    HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_NOT_FOUND,
    HTTP_PRECONDITION_FAILED, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED, HTTP_LOCKED, HTTP_FORBIDDEN,
    DAY, CFG, enforceFinal, pathEncode, prefix, getOrSet, Dict, Timeout, join as crossJoin, try_, safeDecodeURIComponent
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
import { XMLParser } from 'fast-xml-parser'
import _ from 'lodash'

const forceWebdavLogin = defineConfig<boolean|string, null|RegExp>(CFG.force_webdav_login, true, compileWebdavAgentRegex)
const webdavInitialAuth = defineConfig<boolean|string, null|RegExp>(CFG.webdav_initial_auth, 'WebDAVFS', compileWebdavAgentRegex)
const webdavPrompted = expiringCache<boolean>(DAY)
const webdavDetectedAgents = expiringCache<boolean>(DAY)

const TOKEN_HEADER = 'lock-token'
const WEBDAV_METHODS = new Set(['PROPFIND', 'MKCOL', 'MOVE', 'LOCK', 'UNLOCK'])
const WEBDAV_HINT_HEADERS = ['depth', 'destination', 'overwrite', 'translate', 'if', TOKEN_HEADER, 'x-expected-entity-length']
const KNOWN_UA = /webdav|miniredir|davclnt/i
const LOCK_DEFAULT_SECONDS = 3600
const LOCK_MAX_SECONDS = DAY / 1000
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true })

const canOverwrite = new Set<string>()
const locks = new Map<string, { token: string, timeout: NodeJS.Timeout, seconds: number }>()

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
    let {path} = ctx
    path = path.replace(/^\/+/, '/') // double-slash is causing empty listing in filezilla-pro

    const ua = ctx.get('user-agent')
    if (path.includes('/._') && ua?.startsWith('WebDAVFS')) {// too much spam from Finder for these files that can contain metas
        ctx.state.dontLog = true
        return ctx.status = HTTP_FORBIDDEN
    }
    const isWebdavAuthRequest = WEBDAV_METHODS.has(ctx.method) || WEBDAV_HINT_HEADERS.some(h => ctx.get(h))
    if (isWebdavAuthRequest && ua && getCurrentUsername(ctx))
        webdavDetectedAgents.try(webdavAgentKey(ctx, ua), () => true)

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
        const overwriteGraceKey = path + prefix('|', getCurrentUsername(ctx)) // bind temporary overwrite grace to the authenticated user so accounts cannot reuse each other's grace window
        // Finder first creates an empty file (a test?) then wants to overwrite it, which requires deletion permission, but the user may not have it, causing a renamed upload. To solve, so we give it special permission for a few seconds.
        const x = ctx.get('x-expected-entity-length') // field used by Finder's webdav on actual upload, after
        if (!x && !ctx.length) {
            canOverwrite.add(overwriteGraceKey)
            setTimeout(() => canOverwrite.delete(overwriteGraceKey), 10_000) // grace period
        }
        else if (canOverwrite.has(overwriteGraceKey)) {
            canOverwrite.delete(overwriteGraceKey)
            const node = await urlToNode(path, ctx)
            if (node?.source)
                await rm(node.source).catch(() => {})
        }
        if (x && ctx.length === undefined) // missing length can make PUT fail
            ctx.req.headers['content-length'] = x

        if (KNOWN_UA.test(ua) || webdavDetectedAgents.has(webdavAgentKey(ctx, ua)))
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
        dest = crossJoin(ctx.state.root || '', dest) // on Windows, we must use / as the delimiter to be able to compare with `path` below
        if (isLocked(dest, ctx)) return true
        if (dirname(path) === dirname(dest)) // rename case. `path` is is encoded, so we test before decoding `dest`
            try {
                // decode the single path segment so reserved chars like %2C become their real name on rename
                const newName = safeDecodeURIComponent(basename(dest), '')
                if (!newName)
                    return ctx.status = HTTP_BAD_REQUEST
                await requestedRename(node, newName, ctx)
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
        const body = ctx.length || ctx.get('content-length') || ctx.get('transfer-encoding') ? await stream2string(ctx.req) : ''
        const token = getProvidedLockToken(ctx)
        let seconds = Number(ctx.get('timeout').split(',').find(x => /^Second-\d+$/i.test(x.trim()))?.trim().split('-', 2)[1])
        seconds = _.clamp(seconds || LOCK_DEFAULT_SECONDS, 1, LOCK_MAX_SECONDS)

        if (!body) {
            // Finder and similar clients refresh an existing lock by sending LOCK without a body
            if (!token)
                return ctx.status = HTTP_BAD_REQUEST
            const lock = locks.get(path)
            if (token !== lock?.token)
                return ctx.status = HTTP_PRECONDITION_FAILED
            // refresh lock – keep the same token on refresh so clients can continue using the lock they already hold
            clearTimeout(lock.timeout)
            lock.timeout = setTimeout(() => locks.delete(path), seconds * 1000)
            lock.seconds = seconds
            locks.set(path, lock)

            ctx.set(TOKEN_HEADER, lock.token)
            ctx.body = renderLockResponse(lock.token, lock.seconds)
            return true
        }
        const lockinfo = try_(() => xmlParser.parse(body).lockinfo)
        const scope = _.keys(lockinfo?.lockscope)[0]
        const type = _.keys(lockinfo?.locktype)[0]
        if (!scope || !type)
            return ctx.status = HTTP_BAD_REQUEST
        if (ctx.get('depth') && ctx.get('depth') !== '0')
            return ctx.status = HTTP_CONFLICT
        if (scope !== 'exclusive' || type !== 'write')
            return ctx.status = HTTP_CONFLICT
        if (locks.has(path))
            return ctx.status = HTTP_LOCKED
        const newToken = 'urn:uuid:' + randomUUID()
        const timeout = setTimeout(() => locks.delete(path), seconds * 1000)
        locks.set(path, { token: newToken, timeout, seconds })
        ctx.set(TOKEN_HEADER, newToken)
        ctx.body = renderLockResponse(newToken, seconds)
        return true

        function getProvidedLockToken(ctx: Koa.Context) {
            const direct = ctx.get(TOKEN_HEADER).replace(/[<>]/g, '')
            if (direct)
                return direct
            const ifHeader = ctx.get('If')
            return /<([^>]+)>/.exec(ifHeader)?.[1] || ''
        }

        function renderLockResponse(token: string, seconds: number) {
            return `<?xml version="1.0" encoding="utf-8"?><prop xmlns="DAV:"><lockdiscovery><activelock>
                <locktype><write/></locktype>
                <lockscope><exclusive/></lockscope>
                <locktoken><href>${_.escape(token)}</href></locktoken>
                <lockroot><href>${_.escape(path)}</href></lockroot>
                <depth>0</depth>
                <timeout>Second-${seconds}</timeout>
            </activelock></lockdiscovery></prop>`
        }

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
        const outPath = enforceFinal('/', path.slice(Math.max(0, (ctx.state.root?.length ?? 0) - 1)), true)
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
              <href>${_.escape(outPath + (append ? pathEncode(name, true) + (isDir ? '/' : '') : ''))}</href>
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
        return ctx.status = HTTP_METHOD_NOT_ALLOWED
    }

    function setWebdavHeaders(authenticate=false) {
        ctx.set('DAV', '1,2')
        ctx.set('MS-Author-Via', 'DAV')
        ctx.set('Allow', 'PROPFIND,OPTIONS,DELETE,MOVE,LOCK,UNLOCK,MKCOL,PUT')
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

function webdavAgentKey(ctx: Koa.Context, ua: string) {
    // tying detection to source IP avoids promoting one spoofed UA to global WebDAV behavior
    return `${ctx.ip}|${ua}`
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

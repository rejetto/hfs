import Koa from 'koa'
import { text as stream2string } from 'node:stream/consumers'
import {
    getNodeName, nodeIsFolder, nodeIsLink, nodeStats, statusCodeForMissingPerm, urlToNode, VfsNode, walkNode
} from './vfs'
import {
    HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED, HTTP_NO_CONTENT, HTTP_OK,
    HTTP_PRECONDITION_FAILED, HTTP_SERVER_ERROR, HTTP_UNAUTHORIZED, HTTP_LOCKED, HTTP_FORBIDDEN, HTTP_MESSAGES,
    DAY, CFG, enforceFinal, removeFinal, pathEncode, prefix, getOrSet, Dict, Timeout, join as crossJoin, try_,
    safeDecodeURIComponent, wantArray, BASIC_AUTHENTICATE_HEADER,
} from './cross'
import { PassThrough } from 'stream'
import { mkdir, rm, utimes } from 'fs/promises'
import { STATUS_CODES } from 'http'
import { isValidFileName } from './misc'
import { basename, dirname, join } from 'path'
import { moveFiles, requestedRename } from './frontEndApis'
import { randomUUID } from 'node:crypto'
import { IS_MAC, IS_WINDOWS } from './const'
import fswin from 'fswin'
import { exec } from 'child_process'
import { getCurrentUsername } from './auth'
import { defineConfig } from './config'
import { expiringCache } from './expiringCache'
import { XMLParser } from 'fast-xml-parser'
import _ from 'lodash'
import { deleteStoredFileAttrs } from './fileAttr'

const forceWebdavLogin = defineConfig<boolean|string, null|RegExp>(CFG.force_webdav_login, true, compileWebdavAgentRegex)
const webdavInitialAuth = defineConfig<boolean|string, null|RegExp>(CFG.webdav_initial_auth, 'WebDAVFS', compileWebdavAgentRegex)
const webdavPrompted = expiringCache<boolean>(DAY)
const webdavDetectedAgents = expiringCache<boolean>(DAY)

const TOKEN_HEADER = 'lock-token'
const WEBDAV_METHODS = new Set(['PROPFIND', 'PROPPATCH', 'MKCOL', 'MOVE', 'LOCK', 'UNLOCK'])
const WEBDAV_HINT_HEADERS = ['depth', 'destination', 'overwrite', 'translate', 'if', TOKEN_HEADER, 'x-expected-entity-length']
const KNOWN_UA = /webdav|miniredir|davclnt|microsoft office|ms-office/i
const LOCK_DEFAULT_SECONDS = 3600
const LOCK_MAX_SECONDS = DAY / 1000
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true })
const PROPPATCH_PROTECTED_LIVE_PROPS = new Set([
    'creationdate', 'displayname', 'getcontentlanguage', 'getcontentlength', 'getcontenttype',
    'getetag', 'getlastmodified', 'lockdiscovery', 'resourcetype', 'supportedlock',
])
const PROPPATCH_UTIME_PROPS = new Set(['win32lastmodifiedtime', 'win32lastaccesstime'])
const WINDOWS_FILE_ATTRIBUTE_FLAGS = {
    IS_READ_ONLY: 0x1,
    IS_HIDDEN: 0x2,
    IS_SYSTEM: 0x4,
    IS_ARCHIVED: 0x20,
    IS_TEMPORARY: 0x100,
    IS_OFFLINE: 0x1000,
    IS_NOT_CONTENT_INDEXED: 0x2000,
} as const

const canOverwrite = new Set<string>()
const locks = new Map<string, { token: string, timeout: NodeJS.Timeout, seconds: number, username: string }>()

export function releaseWebdavLock(path: string) {
    const lock = locks.get(path)
    if (!lock) return false
    clearTimeout(lock.timeout)
    locks.delete(path)
    return true
}

async function isLocked(path: string, ctx: Koa.Context) {
    const lock = locks.get(path)
    if (!lock) return false
    // if the resource is gone, keeping the lock only creates fake 423 responses
    if (!await urlToNode(path, ctx)) {
        releaseWebdavLock(path)
        return false
    }
    const ifHeader = ctx.get('If')
    const tokenHeader = ctx.get(TOKEN_HEADER)
    if (isSameLockUsername(lock, ctx) && (hasToken(ifHeader, lock.token) || hasToken(tokenHeader, lock.token)))
        return false
    ctx.status = HTTP_LOCKED
    return true
}

function hasToken(header: string, token: string) {
    if (!header) return false
    return header.includes(`<${token}>`) || header.split(/[,;\s]+/).includes(token)
}

function getWebdavUsername(ctx: Koa.Context) {
    return getCurrentUsername(ctx) || ''
}

function isSameLockUsername(lock: { username: string }, ctx: Koa.Context) {
    return lock.username === getWebdavUsername(ctx)
}

export const webdav: Koa.Middleware = async (ctx, next) => {
    let {path} = ctx
    path = path.replace(/^\/+/, '/') // double-slash is causing empty listing in filezilla-pro

    const ua = ctx.get('user-agent')
    if (path.includes('/._') && ua?.startsWith('WebDAVFS')) {// too much spam from Finder for these files that can contain metas
        ctx.state.dontLog = true
        ctx.state.webdavDetected = true
        return ctx.status = HTTP_FORBIDDEN
    }
    // office starts document access with OPTIONS, then LOCK/GET; challenging OPTIONS keeps the whole exchange in the same WebDAV auth realm
    const isCorsPreflight = ctx.method === 'OPTIONS' && ctx.get('Access-Control-Request-Method')
    const isKnownWebdavAgent = KNOWN_UA.test(ua) || webdavDetectedAgents.has(webdavAgentKey(ctx, ua))
    const isWebdavAuthRequest = !isCorsPreflight && (ctx.method === 'OPTIONS' || WEBDAV_METHODS.has(ctx.method) || WEBDAV_HINT_HEADERS.some(h => ctx.get(h))
        || ctx.method === 'GET' && isKnownWebdavAgent
    )
    if (isWebdavAuthRequest)
        ctx.state.webdavDetected = true
    if (isWebdavAuthRequest && ua && getCurrentUsername(ctx))
        webdavDetectedAgents.try(webdavAgentKey(ctx, ua), () => true)

    if (isCorsPreflight)
        return next()
    if (isWebdavAuthRequest && shouldChallengeWebdav())
        return
    if (ctx.method === 'OPTIONS')
        return handleOptions()
    if (ctx.method === 'GET' && isWebdavAuthRequest)
        return handleGet()
    switch (ctx.method) {
        case 'PUT': return handlePut()
        case 'MKCOL': return handleMkcol()
        case 'MOVE': return handleMove()
        case 'DELETE': return handleDelete()
        case 'UNLOCK': return handleUnlock()
        case 'LOCK': return handleLock()
        case 'PROPFIND': return handlePropfind()
        case 'PROPPATCH': return handleProppatch()
    }
    return next()

    async function handleOptions() {
        setWebdavHeaders()
        ctx.body = ''
    }

    async function handleGet() {
        const node = await urlToNode(path, ctx)
        if (!node || nodeIsFolder(node))
            return next()
        // webdav file reads must not fall through to the browser frontend when auth rejects them
        if (statusCodeForMissingPerm(node, 'can_read', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return
        }
        return next()
    }

    async function handlePut() {
        if (await isLocked(path, ctx)) return
        const overwriteGraceKey = path + prefix('|', getCurrentUsername(ctx)) // bind temporary overwrite grace to the authenticated user so accounts cannot reuse each other's grace window
        // Finder first creates an empty file (a test?) then wants to overwrite it, which requires deletion permission, but the user may not have it, causing a renamed upload. To solve, so we give it special permission for a few seconds.
        const x = ctx.get('x-expected-entity-length') // field used by Finder's webdav on actual upload, after
        if (isKnownWebdavAgent && canOverwrite.has(overwriteGraceKey)) {
            canOverwrite.delete(overwriteGraceKey)
            const node = await urlToNode(path, ctx)
            if (node?.source)
                await rm(node.source)
                    .then(() => deleteStoredFileAttrs(node.source!))
                    .catch(() => {})
        }
        if (x && ctx.length === undefined) // missing length can make PUT fail
            ctx.req.headers['content-length'] = x

        if (isKnownWebdavAgent)
            ctx.query.existing ??= 'overwrite' // with webdav this is our default
        await next()
        if (isKnownWebdavAgent && ctx.body?.uri === path) // the upload middleware reports the final uri that can be different from the initial request
            allowWebdavOverwrite(overwriteGraceKey)
    }

    async function handleMkcol() {
        setWebdavHeaders()
        if (await isLocked(path, ctx)) return
        const node = await urlToNode(path, ctx)
        if (node) {
            ctx.status = HTTP_METHOD_NOT_ALLOWED
            return
        }
        const parentNode = await urlToNode(dirname(path), ctx)
        if (!parentNode) // this is a bit incoherent with the way we handle PUT, which doesn't stop in this case, but it's by RFC 4918 section 9.3
            return ctx.status = HTTP_CONFLICT
        const name = safeDecodeURIComponent(basename(path), '')
        if (!isValidFileName(name))
            return ctx.status = HTTP_BAD_REQUEST
        if (statusCodeForMissingPerm(parentNode, 'can_upload', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return
        }
        try {
            await mkdir(join(parentNode.source!, name))
            return ctx.status = HTTP_CREATED
        }
        catch(e:any) {
            return ctx.status = HTTP_SERVER_ERROR
        }
    }

    async function handleMove() {
        setWebdavHeaders()
        if (await isLocked(path, ctx)) return
        const node = await urlToNode(path, ctx)
        if (!node) return next()
        let dest = ctx.get('destination')
        const i = dest.indexOf('//')
        if (i >= 0)
            dest = dest.slice(dest.indexOf('/', i + 2))
        dest = crossJoin(ctx.state.root || '', dest) // on Windows, we must use / as the delimiter to be able to compare with `path` below
        if (await isLocked(dest, ctx)) return
        if (dirname(path) === dirname(dest)) // rename case. `path` is is encoded, so we test before decoding `dest`
            try {
                // decode the single path segment so reserved chars like %2C become their real name on rename
                const newName = safeDecodeURIComponent(basename(dest), '')
                if (!newName)
                    return ctx.status = HTTP_BAD_REQUEST
                await requestedRename(node, newName, ctx)
                releaseWebdavLock(path) // RFC 4918 says MOVE must not carry locks to destination, so clear source lock on success
                return ctx.status = HTTP_CREATED
            }
            catch(e:any) {
                return ctx.status = e.status || HTTP_SERVER_ERROR
            }
        const moveRes = await moveFiles([path], dirname(dest), ctx)
        if (moveRes instanceof Error)
            return ctx.status = (moveRes as any).status || HTTP_SERVER_ERROR
        const err = moveRes?.errors?.[0]
        if (!err)
            releaseWebdavLock(path) // successful MOVE leaves the old path invalid, therefore its lock must be dropped
        return ctx.status = !err ? HTTP_CREATED : typeof err === 'number' ? err : HTTP_SERVER_ERROR
    }

    async function handleDelete() {
        setWebdavHeaders()
        if (await isLocked(path, ctx)) return
        await next()
        if (ctx.status === HTTP_OK)
            releaseWebdavLock(path) // webdav clients may forget UNLOCK; successful delete must clear any lock
    }

    async function handleUnlock() {
        setWebdavHeaders()
        const x = ctx.get(TOKEN_HEADER).slice(1,-1)
        const lock = locks.get(path)
        if (x !== lock?.token)
            return ctx.status = HTTP_BAD_REQUEST
        // with force_webdav_login disabled a client may silently fall back to anonymous; keep lock ownership on the original username
        if (!isSameLockUsername(lock, ctx))
            return ctx.status = HTTP_PRECONDITION_FAILED
        releaseWebdavLock(path)
        ctx.set(TOKEN_HEADER, x)
        if (IS_MAC)
            urlToNode(path, ctx).then(x => x?.source && dotClean(dirname(x.source)))
        return ctx.status = HTTP_NO_CONTENT
    }

    async function handleLock() {
        setWebdavHeaders()
        const body = ctx.length || ctx.get('content-length') || ctx.get('transfer-encoding') ? await stream2string(ctx.req) : ''
        const token = getProvidedLockToken()
        let seconds = Number(ctx.get('timeout').split(',').find(x => /^Second-\d+$/i.test(x.trim()))?.trim().split('-', 2)[1])
        seconds = _.clamp(seconds || LOCK_DEFAULT_SECONDS, 1, LOCK_MAX_SECONDS)

        if (!body) {
            // Finder and similar clients refresh an existing lock by sending LOCK without a body
            if (!token)
                return ctx.status = HTTP_BAD_REQUEST
            const lock = locks.get(path)
            if (token !== lock?.token)
                return ctx.status = HTTP_PRECONDITION_FAILED
            // same-token refresh from another username would make abandoned locks effectively persistent
            if (!isSameLockUsername(lock, ctx))
                return ctx.status = HTTP_PRECONDITION_FAILED
            // refresh lock - keep the same token on refresh so clients can continue using the lock they already hold
            clearTimeout(lock.timeout)
            lock.timeout = setTimeout(() => releaseWebdavLock(path), seconds * 1000)
            lock.seconds = seconds
            locks.set(path, lock)

            ctx.set(TOKEN_HEADER, lock.token)
            ctx.body = renderLockResponse(lock.token, lock.seconds)
            return
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
        const timeout = setTimeout(() => releaseWebdavLock(path), seconds * 1000)
        locks.set(path, { token: newToken, timeout, seconds, username: getWebdavUsername(ctx) })
        ctx.set(TOKEN_HEADER, newToken)
        ctx.body = renderLockResponse(newToken, seconds)
    }

    async function handlePropfind() {
        setWebdavHeaders()
        const node = await urlToNode(path, ctx)
        if (!node) return next()
        let depth = Number(ctx.get('depth'))
        depth = isNaN(depth) ? Infinity : depth
        const isList = depth !== 0
        if (statusCodeForMissingPerm(node, isList ? 'can_list' : 'can_see', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return
        }
        ctx.type = 'xml'
        ctx.status = 207
        const outPath = webdavHrefPath(path, node, ctx)
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

    async function handleProppatch() {
        setWebdavHeaders()
        if (await isLocked(path, ctx)) return
        const node = await urlToNode(path, ctx)
        if (!node) return next()
        if (statusCodeForMissingPerm(node, 'can_see', ctx)) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return
        }
        const body = ctx.length || ctx.get('content-length') || ctx.get('transfer-encoding') ? await stream2string(ctx.req) : ''
        const props = try_(() => parseProppatchProps(body)) || []
        if (!props.length)
            return ctx.status = HTTP_BAD_REQUEST
        const statuses = []
        for (const prop of props)
            statuses.push({ prop: prop.name, status: await applyProppatchProp(prop, node, path, ctx) })
        const outPath = webdavHrefPath(path, node, ctx)
        ctx.type = 'xml'
        ctx.status = 207
        ctx.body = renderProppatchResponse(outPath, statuses)
    }

    function setWebdavHeaders(authenticate=false) {
        ctx.set('DAV', '1,2')
        ctx.set('MS-Author-Via', 'DAV')
        ctx.set('Allow', 'PROPFIND,PROPPATCH,OPTIONS,DELETE,MOVE,LOCK,UNLOCK,MKCOL,PUT')
        if (authenticate)
            ctx.set('WWW-Authenticate', BASIC_AUTHENTICATE_HEADER)
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

    function getProvidedLockToken() {
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

function compileWebdavAgentRegex(v: boolean|string) {
    return !v ? null : v === true ? /.*/ : new RegExp(v.trim(), 'i')
}

function webdavAgentKey(ctx: Koa.Context, ua: string) {
    // tying detection to source IP avoids promoting one spoofed UA to global WebDAV behavior
    return `${ctx.ip}|${ua}`
}

function allowWebdavOverwrite(key: string) {
    canOverwrite.add(key)
    setTimeout(() => canOverwrite.delete(key), 10_000) // grace period
}

function webdavHrefPath(path: string, node: VfsNode, ctx: Koa.Context) {
    const href = path.slice(Math.max(0, (ctx.state.root?.length ?? 0) - 1))
    // WebDAV clients use href shape to infer resource type, so file hrefs must not look like collections
    return nodeIsFolder(node) ? enforceFinal('/', href) : removeFinal('/', href)
}

interface ProppatchProp {
    name: string
    value: unknown
}

function parseProppatchProps(body: string) {
    const doc = xmlParser.parse(body)
    const update = getXmlChildren(doc, 'propertyupdate')[0]
    if (!update)
        return []
    const ret: ProppatchProp[] = []
    for (const opName of ['set', 'remove'])
        for (const op of getXmlChildren(update, opName))
            for (const prop of getXmlChildren(op, 'prop'))
                for (const k of Object.keys(prop))
                    if (!k.startsWith('@_') && k !== '#text')
                        ret.push({ name: localXmlName(k), value: prop[k] })
    return _.uniqBy(ret, 'name')
}

async function applyProppatchProp(prop: ProppatchProp, node: VfsNode, path: string, ctx: Koa.Context) {
    const k = prop.name.toLowerCase()
    if (PROPPATCH_PROTECTED_LIVE_PROPS.has(k))
        return HTTP_FORBIDDEN
    if (node.source && (PROPPATCH_UTIME_PROPS.has(k) || IS_WINDOWS && k === 'win32fileattributes')) {
        // WebDAV clients patch metadata right after upload; outside that short same-username grace, metadata writes are file modifications
        const missingWritePerm = canOverwrite.has(path + prefix('|', getCurrentUsername(ctx))) ? 0
            : statusCodeForMissingPerm(node, 'can_delete', ctx, false)
        if (missingWritePerm)
            return missingWritePerm
    }
    if (node.source && PROPPATCH_UTIME_PROPS.has(k)) {
        const date = new Date(String(prop.value))
        if (isNaN(Number(date)))
            return HTTP_BAD_REQUEST
        const stats = await nodeStats(node)
        const atime = k === 'win32lastaccesstime' ? date : stats?.atime ?? new Date()
        const mtime = k === 'win32lastmodifiedtime' ? date : stats?.mtime ?? new Date()
        // WebDAV clients often use dead properties for file times; apply the portable subset instead of only pretending success
        await utimes(node.source, atime, mtime)
    }
    if (node.source && IS_WINDOWS && k === 'win32fileattributes') {
        const attributes = parseWindowsFileAttributes(prop.value)
        if (attributes === undefined)
            return HTTP_BAD_REQUEST
        // fswin is already our Windows attribute bridge; this keeps PROPPATCH metadata aligned with the actual filesystem
        const ok = await new Promise<boolean>(resolve =>
            fswin.setAttributes(node.source!, _.mapValues(WINDOWS_FILE_ATTRIBUTE_FLAGS, flag => Boolean(attributes & flag)), ok => resolve(Boolean(ok))) )
        if (!ok)
            return HTTP_SERVER_ERROR
    }
    // PROPPATCH is only persisted when HFS gets real dead-property storage; no-op success keeps Windows and macOS clients from aborting writes
    return HTTP_OK
}

function parseWindowsFileAttributes(v: unknown) {
    const s = String(v).trim()
    if (!s)
        return
    const n = Number(/^0x/i.test(s) || /^[0-9a-f]{8}$/i.test(s) ? '0x' + s.replace(/^0x/i, '') : s)
    if (!Number.isInteger(n) || n < 0)
        return
    return n
}

function renderProppatchResponse(path: string, statuses: { prop: string, status: number }[]) {
    const byStatus = _.groupBy(statuses, 'status')
    return `<?xml version="1.0" encoding="utf-8" ?><multistatus xmlns="DAV:"><response>
        <href>${_.escape(path)}</href>
        ${_.map(byStatus, (items, status) => `<propstat>
            <prop>${items.map(({ prop }) => `<${prop}/>`).join('')}</prop>
            <status>HTTP/1.1 ${status} ${_.escape(HTTP_MESSAGES[Number(status)] || STATUS_CODES[Number(status)] || '')}</status>
        </propstat>`).join('')}
    </response></multistatus>`
}

function getXmlChildren(obj: unknown, name: string) {
    if (!obj || typeof obj !== 'object')
        return []
    return Object.entries(obj).flatMap(([k, v]) => localXmlName(k) === name ? wantArray(v) : [])
}

function localXmlName(name: string) {
    return name.split(':').at(-1) || name
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

declare module "koa" {
    interface DefaultState {
        webdavDetected?: boolean
    }
}

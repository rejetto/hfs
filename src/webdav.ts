import Koa from 'koa'
import { text as stream2string } from 'node:stream/consumers'
import {
    getNodeName, getVirtualName, nodeIsFolder, nodeIsLink, nodeStats, normalizeFilename, statusCodeForMissingPerm, urlToNode, VfsNode, VfsNodeWithPath, walkNode
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
import { hasDirTraversal, isValidFileName } from './misc'
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
import { deleteUploadOwner, getNodeMatchingSource } from './uploadOwners'

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
interface WebdavLock {
    token: string
    timeout: NodeJS.Timeout
    seconds: number
    username: string
    lockNull: boolean
    path: string
}

// WebDAV and frontend mutations share files, so both must observe the same exclusive locks
const locks = new Map<string, WebdavLock>()

function webdavPathKey(path: string) {
    const key = pathEncode(safeDecodeURIComponent(path, ''))
    return hasDirTraversal(key) ? '' : key
}

function webdavStateKey(path: string) {
    const key = normalizeFilename(safeDecodeURIComponent(path, ''))
    return hasDirTraversal(key) ? '' : key
}

function getWebdavLock(path: string) {
    return locks.get(webdavStateKey(path))
}

function setWebdavLock(path: string, lock: WebdavLock) {
    locks.set(webdavStateKey(path), lock)
}

export function releaseWebdavLock(path: string) {
    const key = webdavStateKey(path)
    const lock = locks.get(key)
    if (!lock) return false
    clearTimeout(lock.timeout)
    locks.delete(key)
    return true
}

export function isWebdavLocked(path: string, ctx: Koa.Context) {
    const lock = getWebdavLock(path)
    if (!lock) return false
    const validToken = lock.username === (getCurrentUsername(ctx) || '')
        && [ctx.get('If'), ctx.get(TOKEN_HEADER)].some(header =>
            header.includes(`<${lock.token}>`) || header.split(/[,;\s]+/).includes(lock.token))
    if (validToken)
        return false
    ctx.status = HTTP_LOCKED
    return true
}

interface WebdavResource { key: string, node?: VfsNodeWithPath }

async function resolveWebdavResource(path: string, ctx: Koa.Context): Promise<WebdavResource> {
    const pathKey = webdavPathKey(path)
    const node = await urlToNode(pathKey, ctx)
    if (node)
        return { key: node.vfsPath, node }
    const parent = await urlToNode(dirname(pathKey), ctx)
    const name = safeDecodeURIComponent(basename(pathKey), '')
    const source = parent?.source && join(parent.source, name)
    return {
        key: parent && name ? crossJoin(parent.vfsPath, pathEncode(getVirtualName(name, parent, source))) : pathKey,
    }
}

async function isLocked(path: string, ctx: Koa.Context, resource?: WebdavResource) {
    resource ??= await resolveWebdavResource(path, ctx)
    const { key: resourceKey, node } = resource
    const lock = getWebdavLock(resourceKey)
    if (!lock) return false
    // if the resource is gone, keeping the lock only creates fake 423 responses
    // alias callers share the key, but only the path that created the lock proves it became stale
    if (!lock.lockNull && !node && !await urlToNode(lock.path, ctx)) {
        releaseWebdavLock(resourceKey)
        return false
    }
    return isWebdavLocked(resourceKey, ctx)
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
    const pathKey = webdavPathKey(path) // state must converge for equivalent encodings without changing client-visible paths
    if (!pathKey && (isWebdavAuthRequest || ctx.method === 'PUT' || ctx.method === 'DELETE'))
        return ctx.status = HTTP_BAD_REQUEST
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
        const resource = await resolveWebdavResource(pathKey, ctx)
        const resourceKey = resource.key
        if (await isLocked(resourceKey, ctx, resource)) return
        const overwriteGraceKey = webdavStateKey(resourceKey) + prefix('|', getCurrentUsername(ctx)) // bind temporary overwrite grace to the authenticated user so accounts cannot reuse each other's grace window
        // Finder first creates an empty file (a test?) then wants to overwrite it, which requires deletion permission, but the user may not have it, causing a renamed upload. To solve, so we give it special permission for a few seconds.
        const x = ctx.get('x-expected-entity-length') // field used by Finder's webdav on actual upload, after
        if (isKnownWebdavAgent && canOverwrite.has(overwriteGraceKey)) {
            canOverwrite.delete(overwriteGraceKey)
            const node = await urlToNode(resourceKey, ctx)
            if (node?.source)
                await rm(node.source)
                    .then(() => deleteStoredFileAttrs(node.source!))
                    .then(() => deleteUploadOwner(node.vfsPath))
                    .catch(() => {})
        }
        if (x && ctx.length === undefined) // missing length can make PUT fail
            ctx.req.headers['content-length'] = x

        if (isKnownWebdavAgent)
            ctx.query.existing ??= 'overwrite' // with webdav this is our default
        await next()
        // the upload response URI may differ from the file it actually created when VFS aliases collide
        if (isKnownWebdavAgent && ctx.body?.uri && ctx.state.uploadDestinationPath) {
            const node = await getNodeMatchingSource(ctx.body.uri, ctx, ctx.state.uploadDestinationPath)
            if (node)
                allowWebdavOverwrite(webdavStateKey(node.vfsPath) + prefix('|', getCurrentUsername(ctx)))
        }
    }

    async function handleMkcol() {
        setWebdavHeaders()
        const resource = await resolveWebdavResource(pathKey, ctx)
        if (await isLocked(path, ctx, resource)) return
        const { node } = resource
        if (node) {
            ctx.status = HTTP_METHOD_NOT_ALLOWED
            return
        }
        const parentNode = await urlToNode(dirname(pathKey), ctx)
        if (!parentNode) // this is a bit incoherent with the way we handle PUT, which doesn't stop in this case, but it's by RFC 4918 section 9.3
            return ctx.status = HTTP_CONFLICT
        const name = safeDecodeURIComponent(basename(pathKey), '')
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
        const resource = await resolveWebdavResource(pathKey, ctx)
        const { node } = resource
        if (await isLocked(path, ctx, resource)) return
        if (!node) return next()
        let dest = ctx.get('destination')
        const i = dest.indexOf('//')
        if (i >= 0)
            dest = dest.slice(dest.indexOf('/', i + 2))
        dest = webdavPathKey(crossJoin(ctx.state.root || '', dest)) // on Windows, we must use / as the delimiter to compare URL paths
        if (!dest)
            return ctx.status = HTTP_BAD_REQUEST
        if (await isLocked(dest, ctx)) return
        const destParent = await urlToNode(dirname(dest), ctx)
        if (node.parent && destParent
        && webdavStateKey(destParent.vfsPath) === webdavStateKey(node.parent.vfsPath))
            try {
                // decode the single path segment so reserved chars like %2C become their real name on rename
                await requestedRename(node, safeDecodeURIComponent(basename(dest), ''), ctx)
                releaseWebdavLock(node.vfsPath) // RFC 4918 says MOVE must not carry locks to destination, so clear source lock on success
                return ctx.status = HTTP_CREATED
            }
            catch(e:any) {
                return ctx.status = e.status || HTTP_SERVER_ERROR
            }
        const actualDest = crossJoin(dirname(dest), basename(pathKey))
        // moveFiles keeps the source basename for cross-directory moves, so check the lock it will actually touch
        if (actualDest !== dest && await isLocked(actualDest, ctx)) return
        const moveRes = await moveFiles([pathKey], dirname(dest), ctx)
        if (moveRes instanceof Error)
            return ctx.status = (moveRes as any).status || HTTP_SERVER_ERROR
        const err = moveRes?.errors?.[0]
        if (!err)
            releaseWebdavLock(node.vfsPath) // successful MOVE leaves the old path invalid, therefore its lock must be dropped
        return ctx.status = !err ? HTTP_CREATED : typeof err === 'number' ? err : HTTP_SERVER_ERROR
    }

    async function handleDelete() {
        setWebdavHeaders()
        const resource = await resolveWebdavResource(pathKey, ctx)
        const { node } = resource
        if (await isLocked(path, ctx, resource)) return
        await next()
        if (ctx.status === HTTP_OK)
            releaseWebdavLock(node?.vfsPath || path) // webdav clients may forget UNLOCK; successful delete must clear any lock
    }

    async function handleUnlock() {
        setWebdavHeaders()
        const x = ctx.get(TOKEN_HEADER).slice(1,-1)
        const lockKey = (await resolveWebdavResource(pathKey, ctx)).key
        const lock = getWebdavLock(lockKey)
        if (x !== lock?.token)
            return ctx.status = HTTP_BAD_REQUEST
        // with force_webdav_login disabled a client may silently fall back to anonymous; keep lock ownership on the original username
        if (!isSameLockUsername(lock, ctx))
            return ctx.status = HTTP_PRECONDITION_FAILED
        releaseWebdavLock(lockKey)
        ctx.set(TOKEN_HEADER, x)
        if (IS_MAC)
            urlToNode(path, ctx).then(x => x?.source && dotClean(dirname(x.source)))
        return ctx.status = HTTP_NO_CONTENT
    }

    async function handleLock() {
        setWebdavHeaders()
        // a lock reserves a future write, so authorize it against the existing resource or its parent
        const { key: lockKey, node } = await resolveWebdavResource(pathKey, ctx)
        const permissionNode = node || await urlToNode(dirname(pathKey), ctx)
        if (!permissionNode)
            return ctx.status = HTTP_CONFLICT
        const missingWritePerm = node && canOverwrite.has(webdavStateKey(lockKey) + prefix('|', getCurrentUsername(ctx))) ? 0
            : statusCodeForMissingPerm(permissionNode, node ? 'can_delete' : 'can_upload', ctx)
        if (missingWritePerm) {
            if (ctx.status === HTTP_UNAUTHORIZED)
                setWebdavHeaders(true)
            return
        }
        const body = ctx.length || ctx.get('content-length') || ctx.get('transfer-encoding') ? await stream2string(ctx.req) : ''
        const token = getProvidedLockToken()
        let seconds = Number(ctx.get('timeout').split(',').find(x => /^Second-\d+$/i.test(x.trim()))?.trim().split('-', 2)[1])
        seconds = _.clamp(seconds || LOCK_DEFAULT_SECONDS, 1, LOCK_MAX_SECONDS)

        if (!body) {
            // Finder and similar clients refresh an existing lock by sending LOCK without a body
            if (!token)
                return ctx.status = HTTP_BAD_REQUEST
            const lock = getWebdavLock(lockKey)
            if (token !== lock?.token)
                return ctx.status = HTTP_PRECONDITION_FAILED
            // same-token refresh from another username would make abandoned locks effectively persistent
            if (!isSameLockUsername(lock, ctx))
                return ctx.status = HTTP_PRECONDITION_FAILED
            // refresh lock - keep the same token on refresh so clients can continue using the lock they already hold
            clearTimeout(lock.timeout)
            lock.timeout = setTimeout(() => releaseWebdavLock(lockKey), seconds * 1000)
            lock.seconds = seconds
            setWebdavLock(lockKey, lock)

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
        if (getWebdavLock(lockKey))
            return ctx.status = HTTP_LOCKED
        const newToken = 'urn:uuid:' + randomUUID()
        const timeout = setTimeout(() => releaseWebdavLock(lockKey), seconds * 1000)
        setWebdavLock(lockKey, {
            token: newToken, timeout, seconds, username: getWebdavUsername(ctx), lockNull: !node, path: pathKey,
        })
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
        res.write(`<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:">`)
        await sendEntry(node)
        if (isList) {
            depth = Math.max(0, depth - 1)
            for await (const n of walkNode(node, { ctx, depth }))
                await sendEntry(n, true)
        }
        res.write(`</D:multistatus>`)
        res.end()

        async function sendEntry(node: VfsNode, append=false) {
            if (nodeIsLink(node)) return
            const name = getNodeName(node)
            const isDir = await nodeIsFolder(node)
            const st = append && node.see_without_probing ? undefined : await nodeStats(node)
            res.write(`<D:response>
              <D:href>${_.escape(outPath + (append ? pathEncode(name, true) + (isDir ? '/' : '') : ''))}</D:href>
              <D:propstat>
                <D:prop>
                    ${prefix('<D:getlastmodified>', (st?.mtime as any)?.toGMTString(), '</D:getlastmodified>')}
                    ${prefix('<D:creationdate>', (st?.birthtime || st?.ctime)?.toISOString().replace(/\..*/, '-00:00'), '</D:creationdate>')}
                    ${isDir ? '<D:resourcetype><D:collection/></D:resourcetype>'
                : `<D:resourcetype/><D:getcontentlength>${st?.size}</D:getcontentlength>`}
                </D:prop>
                <D:status>HTTP/1.1 200 OK</D:status>
              </D:propstat>
              </D:response>
            `)
        }
    }

    async function handleProppatch() {
        setWebdavHeaders()
        if (await isLocked(path, ctx)) return
        const node = await urlToNode(pathKey, ctx)
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
            statuses.push({ prop: prop.name, status: await applyProppatchProp(prop, node, node.vfsPath, ctx) })
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
        return `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>
            <D:locktype><D:write/></D:locktype>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktoken><D:href>${_.escape(token)}</D:href></D:locktoken>
            <D:lockroot><D:href>${_.escape(path)}</D:href></D:lockroot>
            <D:depth>0</D:depth>
            <D:timeout>Second-${seconds}</D:timeout>
        </D:activelock></D:lockdiscovery></D:prop>`
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
    if (!PROPPATCH_UTIME_PROPS.has(k)
    && !(IS_WINDOWS && k === 'win32fileattributes'))
        return HTTP_OK // PROPPATCH is only persisted when HFS gets real dead-property storage; no-op success keeps Windows and macOS clients from aborting writes
    const { source } = node
    if (!source)
        return HTTP_FORBIDDEN
    // WebDAV clients patch metadata right after upload; outside that short same-username grace, metadata writes are file modifications
    const missingWritePerm = canOverwrite.has(webdavStateKey(path) + prefix('|', getCurrentUsername(ctx))) ? 0
        : statusCodeForMissingPerm(node, 'can_delete', ctx, false)
    if (missingWritePerm)
        return missingWritePerm
    if (PROPPATCH_UTIME_PROPS.has(k)) {
        const date = new Date(String(prop.value))
        if (isNaN(Number(date)))
            return HTTP_BAD_REQUEST
        const stats = await nodeStats(node)
        const atime = k === 'win32lastaccesstime' ? date : stats?.atime ?? new Date()
        const mtime = k === 'win32lastmodifiedtime' ? date : stats?.mtime ?? new Date()
        // WebDAV clients often use dead properties for file times; apply the portable subset instead of only pretending success
        await utimes(source, atime, mtime)
    }
    else {
        const attributes = parseWindowsFileAttributes(prop.value)
        if (attributes === undefined)
            return HTTP_BAD_REQUEST
        // fswin is already our Windows attribute bridge; this keeps PROPPATCH metadata aligned with the actual filesystem
        const ok = await new Promise<boolean>(resolve =>
            fswin.setAttributes(source, _.mapValues(WINDOWS_FILE_ATTRIBUTE_FLAGS, flag => Boolean(attributes & flag)), ok => resolve(Boolean(ok))) )
        if (!ok)
            return HTTP_SERVER_ERROR
    }
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
    return `<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"><D:response>
        <D:href>${_.escape(path)}</D:href>
        ${_.map(byStatus, (items, status) => `<D:propstat>
            <D:prop>${items.map(({ prop }) => `<D:${prop}/>`).join('')}</D:prop>
            <D:status>HTTP/1.1 ${status} ${_.escape(HTTP_MESSAGES[Number(status)] || STATUS_CODES[Number(status)] || '')}</D:status>
        </D:propstat>`).join('')}
    </D:response></D:multistatus>`
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

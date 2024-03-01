// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getNodeName, isSameFilenameAs, nodeIsDirectory, saveVfs, urlToNode, vfs, VfsNode, applyParentToChild,
    permsFromParent, nodeIsLink } from './vfs'
import _ from 'lodash'
import { mkdir, stat } from 'fs/promises'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { dirname, extname, join, resolve } from 'path'
import { dirStream, enforceFinal, isDirectory, isValidFileName, isWindowsDrive, makeMatcher, PERM_KEYS,
    VfsNodeAdminSend } from './misc'
import { IS_WINDOWS, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_CONFLICT, HTTP_NOT_ACCEPTABLE } from './const'
import { getDiskSpaceSync, getDrives } from './util-os'
import { getBaseUrlOrDefault, getServerStatus } from './listen'
import { promisify } from 'util'
import { execFile } from 'child_process'
import { SendListReadable } from './SendList'

// to manipulate the tree we need the original node
async function urlToNodeOriginal(uri: string) {
    const n = await urlToNode(uri)
    return n?.isTemp ? n.original : n
}

const ALLOWED_KEYS = ['name','source','masks','default','accept','rename','mime','url', ...PERM_KEYS]

const apis: ApiHandlers = {

    async get_vfs() {
        return { root: await recur() }

        async function recur(node=vfs): Promise<VfsNodeAdminSend> {
            const { source } = node
            const stats = !source ? undefined : await stat(source!).catch(() => undefined)
            const isDir = !nodeIsLink(node) && (!source || (stats?.isDirectory() ?? node.children?.length! > 0))
            const copyStats: Pick<VfsNodeAdminSend, 'size' | 'ctime' | 'mtime'> = stats ? _.pick(stats, ['size', 'ctime', 'mtime'])
                : { size: source ? -1 : undefined }
            if (copyStats.mtime && Number(copyStats.mtime) === Number(copyStats.ctime))
                delete copyStats.mtime
            const inherited = node.parent && permsFromParent(node.parent, node.original || node)
            const byMasks = node.original && _.pickBy(node, (v,k) =>
                v !== (node.original as any)[k] // something is changing me...
                && !(inherited && k in inherited) // ...and it's not inheritance...
                && PERM_KEYS.includes(k as any)) // ...must be masks. Please limit this to perms
            return {
                ...copyStats,
                ...node.original || node,
                inherited,
                byMasks: _.isEmpty(byMasks) ? undefined : byMasks,
                website: Boolean(node.children?.find(isSameFilenameAs('index.html')))
                    || isDir && source && await stat(join(source, 'index.html')).then(() => true, () => undefined)
                    || undefined,
                name: node === vfs ? '' : getNodeName(node),
                type: isDir ? 'folder' : undefined,
                children: node.children && await Promise.all(node.children.map(async child =>
                    recur(await applyParentToChild(child, node)) ))
            }
        }
    },

    async move_vfs({ from, parent }) {
        if (!from || !parent)
            return new ApiError(HTTP_BAD_REQUEST)
        const fromNode = await urlToNodeOriginal(from)
        if (!fromNode)
            return new ApiError(HTTP_NOT_FOUND, 'from not found')
        if (fromNode === vfs)
            return new ApiError(HTTP_BAD_REQUEST, 'from is root')
        if (parent.startsWith(from))
            return new ApiError(HTTP_BAD_REQUEST, 'incompatible parent')
        const parentNode = await urlToNodeOriginal(parent)
        if (!parentNode)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        const name = getNodeName(fromNode)
        if (parentNode.children?.find(x => name === getNodeName(x)))
            return new ApiError(HTTP_CONFLICT, 'item with same name already present in destination')
        const oldParent = await urlToNodeOriginal(dirname(from))
        _.pull(oldParent!.children!, fromNode)
        if (_.isEmpty(oldParent!.children))
            delete oldParent!.children
        ;(parentNode.children ||= []).push(fromNode)
        saveVfs()
        return {}
    },

    async set_vfs({ uri, props }) {
        const n = await urlToNodeOriginal(uri)
        if (!n)
            return new ApiError(HTTP_NOT_FOUND, 'path not found')
        props = pickProps(props, ALLOWED_KEYS) // sanitize
        if (props.name && props.name !== getNodeName(n)) {
            if (!isValidFileName(props.name))
                return new ApiError(HTTP_BAD_REQUEST, 'bad name')
            const parent = await urlToNodeOriginal(dirname(uri))
            if (parent?.children?.find(x => getNodeName(x) === props.name))
                return new ApiError(HTTP_CONFLICT, 'name already present')
        }
        if (props.masks && typeof props.masks !== 'object')
            delete props.masks
        Object.assign(n, props)
        simplifyName(n)
        saveVfs()
        return n
    },

    async add_vfs({ parent, source, name, ...rest }) {
        if (!source && !name)
            return new ApiError(HTTP_BAD_REQUEST, 'name or source required')
        if (!isValidFileName(name))
            return new ApiError(HTTP_BAD_REQUEST, 'bad name')
        const parentNode = parent ? await urlToNodeOriginal(parent) : vfs
        if (!parentNode)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        if (!await nodeIsDirectory(parentNode))
            return new ApiError(HTTP_NOT_ACCEPTABLE, 'parent not a folder')
        if (isWindowsDrive(source))
            source += '\\' // slash must be included, otherwise it will refer to the cwd of that drive
        const isDir = source && await isDirectory(source)
        if (source && isDir === undefined)
            return new ApiError(HTTP_NOT_FOUND, 'source not found')
        const child = { source, name, ...pickProps(rest, ALLOWED_KEYS) }
        name = getNodeName(child) // could be not given as input
        const ext = extname(name)
        const noExt = ext ? name.slice(0, -ext.length) : name
        let idx = 2
        while (parentNode.children?.find(isSameFilenameAs(name)))
            name = `${noExt} ${idx++}${ext}`
        child.name = name
        simplifyName(child)
        ;(parentNode.children ||= []).unshift(child)
        saveVfs()
        const link = rest.url ? undefined : getBaseUrlOrDefault()
            + (parent ? enforceFinal('/', parent) : '/')
            + encodeURIComponent(getNodeName(child))
            + (isDir ? '/' : '')
        return { name, link }
    },

    async del_vfs({ uris }) {
        if (!uris || !Array.isArray(uris))
            return new ApiError(HTTP_BAD_REQUEST, 'bad uris')
        return {
            errors: await Promise.all(uris.map(async uri => {
                if (typeof uri !== 'string')
                    return HTTP_BAD_REQUEST
                if (uri === '/')
                    return HTTP_NOT_ACCEPTABLE
                const node = await urlToNodeOriginal(uri)
                if (!node)
                    return HTTP_NOT_FOUND
                const parent = dirname(uri)
                const parentNode = await urlToNodeOriginal(parent)
                if (!parentNode) // shouldn't happen
                    return HTTP_SERVER_ERROR
                const { children } = parentNode
                if (!children) // shouldn't happen
                    return HTTP_SERVER_ERROR
                const idx = children.indexOf(node)
                children.splice(idx, 1)
                saveVfs()
                return 0 // error code 0 is OK
            }))
        }
    },

    get_cwd() {
        return { path: process.cwd() }
    },

    async resolve_path({ path, closestFolder }) {
        path = resolve(path)
        if (closestFolder)
            while (path && !await isDirectory(path))
                path = dirname(path)
        return { path, isFolder: await isDirectory(path) }
    },

    async mkdir({ path }) {
        await mkdir(path, { recursive: true })
        return {}
    },

    get_ls({ path, files=true, fileMask }, ctx) {
        return new SendListReadable({
            async doAtStart(list) {
                if (!path && IS_WINDOWS) {
                    try {
                        for (const n of await getDrives())
                            list.add({ n, k: 'd' })
                    } catch (error) {
                        console.debug(error)
                    }
                    return
                }
                try { list.props(getDiskSpaceSync(path)) }
                catch {} // continue anyway
                try {
                    const matching = makeMatcher(fileMask)
                    path = isWindowsDrive(path) ? path + '\\' : resolve(path || '/')
                    for await (const [name, isDir] of dirStream(path)) {
                        if (ctx.req.aborted)
                            return
                        if (!isDir)
                            if (!files || fileMask && !matching(name))
                                continue
                        try {
                            const stats = await stat(join(path, name))
                            list.add({
                                n: name,
                                s: stats.size,
                                c: stats.ctime,
                                m: stats.mtime,
                                k: isDir ? 'd' : undefined,
                            })
                        } catch {} // just ignore entries we can't stat
                    }
                    list.close()
                } catch (e: any) {
                    list.error(e.code || e.message || String(e), true)
                }
            }
        })
    },

    async windows_integration({ parent }) {
        const status = await getServerStatus(true)
        const h = status.http.listening ? status.http : status.https
        const url = h.srv!.name + '://localhost:' + h.port
        for (const k of ['*', 'Directory']) {
            await reg('add', WINDOWS_REG_KEY.replace('*', k), '/ve', '/f', '/d', 'Add to HFS (new)')
            await reg('add', WINDOWS_REG_KEY.replace('*', k) + '\\command', '/ve', '/f', '/d', `powershell -Command "
            $j = '{ \\"parent\\": \\"${parent}\\", \\"source\\": "' + ('%1'|convertTo-json) + '" }'; $j = [System.Text.Encoding]::UTF8.GetBytes($j); $wsh = New-Object -ComObject Wscript.Shell; 
            try { $res = Invoke-WebRequest -Uri '${url}/~/api/add_vfs' -Method POST -Headers @{ 'x-hfs-anti-csrf' = '1' } -ContentType 'application/json' -TimeoutSec 1 -Body $j; 
            $json = $res.Content | ConvertFrom-Json; $link = $json.link; $link | Set-Clipboard; } catch { $wsh.Popup('Server is down', 0, 'Error', 16); }"`)
        }
        return {}
    },

    async windows_integrated() {
        return {
            is: await reg('query', WINDOWS_REG_KEY)
                .then(x => x.stdout.includes('REG_SZ'), () => false)
        }
    },

    async windows_remove() {
        for (const k of ['*', 'Directory'])
            await reg('delete', WINDOWS_REG_KEY.replace('*',k), '/f')
        return {}
    },

}

export default apis

// pick only selected props, and consider null and empty string as undefined
function pickProps(o: any, keys: string[]) {
    const ret: any = {}
    if (o && typeof o === 'object')
        for (const k of keys)
            if (k in o)
                ret[k] = o[k] === null || o[k] === '' ? undefined : o[k]
    return ret
}

function simplifyName(node: VfsNode) {
    const { name, ...noName } = node
    if (getNodeName(noName) === name)
        delete node.name
}

const WINDOWS_REG_KEY = 'HKCU\\Software\\Classes\\*\\shell\\AddToHFS3'

function reg(...pars: string[]) {
    return promisify(execFile)('reg', pars)
}

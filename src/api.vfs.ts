// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    getNodeName, isSameFilenameAs, nodeIsFolder, saveVfs, urlToNode, vfs, VfsNode, applyParentToChild,
    permsFromParent, VfsNodeStored, isRoot, nodeStats
} from './vfs'
import _ from 'lodash'
import { mkdir } from 'fs/promises'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { dirname, extname, join, resolve } from 'path'
import {
    enforceFinal, enforceStarting, isDirectory, isValidFileName, isWindowsDrive, makeMatcher, PERM_KEYS,
    statWithTimeout, VfsNodeAdminSend
} from './misc'
import {
    IS_WINDOWS, HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_CONFLICT, HTTP_NOT_ACCEPTABLE,
    IS_BINARY, APP_PATH
} from './const'
import { getDiskSpace, getDiskSpaces, getDrives, reg } from './util-os'
import { getBaseUrlOrDefault, getServerStatus } from './listen'
import { SendListReadable } from './SendList'
import { walkDir } from './walkDir'

// to manipulate the tree we need the original node
async function urlToNodeOriginal(uri: string) {
    const n = await urlToNode(uri)
    return n?.isTemp ? n.original : n
}

const ALLOWED_KEYS: (keyof VfsNodeStored)[] = ['name', 'source', 'masks', 'default', 'accept', 'rename', 'mime', 'url',
    'target', 'comment', 'icon', 'order', ...PERM_KEYS]

export interface LsEntry { n:string, s?:number, m?:string, c?:string, k?:'d' }

export default {

    async get_vfs() {
        return { root: await recur() }

        async function recur(node=vfs): Promise<VfsNodeAdminSend> {
            const { source } = node
            const stats = await nodeStats(node)
            const isFolder = nodeIsFolder(node)
            const copyStats: Pick<VfsNodeAdminSend, 'size' | 'birthtime' | 'mtime'> = stats ? _.pick(stats, ['size', 'birthtime', 'mtime'])
                : { size: source ? -1 : undefined }
            if (copyStats.mtime && (stats?.mtimeMs! - stats?.birthtimeMs!) < 1000)
                delete copyStats.mtime
            const inherited = node.parent && permsFromParent(node.parent, {})
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
                    || isFolder && source && await statWithTimeout(join(source, 'index.html')).then(() => true, () => undefined)
                    || undefined,
                name: getNodeName(node),
                type: isFolder ? 'folder' : undefined,
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
        if (isRoot(fromNode))
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
        await saveVfs()
        return {}
    },

    async set_vfs({ uri, props }) {
        const n = await urlToNodeOriginal(uri)
        if (!n)
            return new ApiError(HTTP_NOT_FOUND, 'path not found')
        if (props.name && props.name !== getNodeName(n)) {
            if (!isValidFileName(props.name))
                return new ApiError(HTTP_BAD_REQUEST, 'bad name')
            const parent = await urlToNodeOriginal(dirname(uri))
            if (parent?.children?.find(x => getNodeName(x) === props.name))
                return new ApiError(HTTP_CONFLICT, 'name already present')
        }
        if (props.masks && typeof props.masks !== 'object')
            delete props.masks
        Object.assign(n, pickProps(props, ALLOWED_KEYS))
        simplifyName(n)
        n.isFolder = undefined // reset field, it will be set by saveVfs
        await saveVfs()
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
        if (!nodeIsFolder(parentNode))
            return new ApiError(HTTP_NOT_ACCEPTABLE, 'parent not a folder')
        if (isWindowsDrive(source))
            source += '\\' // slash must be included, otherwise it will refer to the cwd of that drive
        const isFolder = source && await isDirectory(source)
        if (source && isFolder === undefined)
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
        await saveVfs()
        const link = rest.url ? undefined : await getBaseUrlOrDefault()
            + (parent ? enforceStarting('/', enforceFinal('/', parent)) : '/')
            + encodeURIComponent(getNodeName(child))
            + (isFolder ? '/' : '')
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
                return 0 // error code 0 is OK
            })).finally(saveVfs)
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

    get_disk_spaces: getDiskSpaces,

    get_ls({ path, files, fileMask }, ctx) {
        return new SendListReadable<LsEntry>({
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
                const sendPropsAsap = getDiskSpace(path).then(x => x && list.props(x))
                try {
                    const matching = makeMatcher(fileMask)
                    path = isWindowsDrive(path) ? path + '\\' : resolve(path || '/')
                    await walkDir(path, { ctx }, async entry => {
                        if (ctx.isAborted())
                            return null
                        const {path:name} = entry
                        const isDir = entry.isDirectory()
                        if (!isDir)
                            if (!files || fileMask && !matching(name))
                                return
                        try {
                            const stats = entry.stats || await statWithTimeout(join(path, name))
                            list.add({
                                n: name,
                                s: stats.size,
                                c: stats.birthtime.toJSON(),
                                m: stats.mtime.toJSON(),
                                k: isDir ? 'd' : undefined,
                            })
                        } catch {} // just ignore entries we can't stat
                    })
                    await sendPropsAsap.catch(() => {})
                    list.close()
                } catch (e: any) {
                    list.error(e.code || e.message || String(e), true)
                }
            }
        })
    },

    async windows_integration({ parent }) {
        const status = await getServerStatus(true)
        const useHttp = status.http.listening
        const h = useHttp ? status.http : status.https // prefer http on localhost
        const url = h.srv!.name + '://localhost:' + h.port
        for (const k of ['*', 'Directory']) {
            await reg('add', WINDOWS_REG_KEY.replace('*', k), '/ve', '/f', '/d', 'Add to HFS (new)')
            await reg('add', WINDOWS_REG_KEY.replace('*', k), '/v', 'icon', '/f', '/d', IS_BINARY ? process.execPath : APP_PATH + '\\hfs.ico')
            await reg('add', WINDOWS_REG_KEY.replace('*', k) + '\\command', '/ve', '/f', '/d', `powershell -WindowStyle Hidden -Command "
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12;
            $wsh = New-Object -ComObject Wscript.Shell;
            $j = @{parent=@'\n${parent}\n'@; source=@'\n%1\n'@} | ConvertTo-Json -Compress
            $j = [System.Text.Encoding]::UTF8.GetBytes($j);
            ${useHttp ? '' : '[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}'}  
            try {
                $res = Invoke-WebRequest -Uri '${url}/~/api/add_vfs' -UseBasicParsing -Method POST -Headers @{ 'x-hfs-anti-csrf' = '1' } -ContentType 'application/json' -TimeoutSec 3 -Body $j; 
                $json = $res.Content | ConvertFrom-Json; $link = $json.link; $link | Set-Clipboard;
                $wsh.Popup('The link is ready to be pasted');
            } catch { $wsh.Popup($_.Exception.Message + ' – ' + '${url}', 0, 'Error', 16); }"`)
        }
        return {}
    },

    async windows_integrated() {
        return {
            is: await reg('query', WINDOWS_REG_KEY)
                .then(x => x.includes('REG_SZ'), () => false)
        }
    },

    async windows_remove() {
        for (const k of ['*', 'Directory'])
            await reg('delete', WINDOWS_REG_KEY.replace('*',k), '/f')
        return {}
    },

} satisfies ApiHandlers

// pick only selected props, and consider null and empty string as undefined, as it's the default value and we don't want to store it
export function pickProps(o: any, keys: string[]) {
    const ret: any = {}
    if (o && typeof o === 'object')
        for (const k of keys)
            if (k in o)
                ret[k] = o[k] === null || o[k] === '' ? undefined : o[k]
    return ret
}

export function simplifyName(node: VfsNode) {
    const { name, ...noName } = node
    if (getNodeName(noName) === name)
        delete node.name
}

const WINDOWS_REG_KEY = 'HKCU\\Software\\Classes\\*\\shell\\AddToHFS3'

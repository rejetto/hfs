// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    defaultPerms,
    getNodeName,
    isSameFilenameAs,
    nodeIsDirectory,
    saveVfs,
    urlToNode,
    vfs,
    VfsNode,
    PERM_KEYS,
    applyParentToChild
} from './vfs'
import _ from 'lodash'
import { stat } from 'fs/promises'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { dirname, extname, join, resolve } from 'path'
import { dirStream, isDirectory, isWindowsDrive, makeMatcher } from './misc'
import {
    IS_WINDOWS,
    HTTP_BAD_REQUEST, HTTP_NOT_FOUND, HTTP_SERVER_ERROR, HTTP_CONFLICT, HTTP_NOT_ACCEPTABLE,
} from './const'
import { getDrives } from './util-os'
import { Stats } from 'fs'

type VfsAdmin = {
    type?: string,
    size?: number,
    ctime?: Date,
    mtime?: Date,
    website?: true,
    byMasks?: any
    children?: VfsAdmin[]
} & Omit<VfsNode, 'type' | 'children'>

// to manipulate the tree we need the original node
async function urlToNodeOriginal(uri: string) {
    const n = await urlToNode(uri)
    return n?.isTemp ? n.original : n
}

const apis: ApiHandlers = {

    async get_vfs() {
        return {
            root: await recur(),
            defaultPerms,
        }

        async function recur(node=vfs): Promise<VfsAdmin> {
            const { source } = node
            const stats: false | Stats = Boolean(source) && await stat(source!).catch(() => false)
            const isDir = !source || stats && stats.isDirectory()
            const copyStats: Pick<VfsAdmin, 'size' | 'ctime' | 'mtime'> = stats ? _.pick(stats, ['size', 'ctime', 'mtime'])
                : { size: source ? -1 : undefined }
            if (copyStats.mtime && Number(copyStats.mtime) === Number(copyStats.ctime))
                delete copyStats.mtime
            let byMasks = node.original && _.pickBy(node, (v,k) =>
                v !== (node.original as any)[k] // something is changing me...
                && v !== (node.parent as any)[k] // ...and it's not inheritance...
                && PERM_KEYS.includes(k as any)) // ...must be masks. Please limit this to perms
            if (_.isEmpty(byMasks))
                byMasks = undefined
            return {
                ...copyStats,
                ...node.original || node,
                byMasks,
                website: Boolean(node.children?.find(isSameFilenameAs('index.html')))
                    || isDir && source && await stat(join(source, 'index.html')).then(() => true, () => undefined)
                    || undefined,
                name: node === vfs ? undefined : getNodeName(node),
                type: isDir ? 'folder' : undefined,
                children: node.children && await Promise.all(node.children.map(child =>
                    recur(applyParentToChild(child, node)) ))
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
        props = pickProps(props, ['name','source','masks','default','accept','propagate', ...PERM_KEYS]) // sanitize
        if (props.name && props.name !== getNodeName(n)) {
            const parent = await urlToNodeOriginal(dirname(uri))
            if (parent?.children?.find(x => getNodeName(x) === props.name))
                return new ApiError(HTTP_CONFLICT, 'name already present')
        }
        if (props.masks && typeof props.masks !== 'object')
            delete props.masks
        Object.assign(n, props)
        simplifyName(n)
        await saveVfs()
        return n
    },

    async add_vfs({ parent, source, name }) {
        if (!source && !name)
            return new ApiError(HTTP_BAD_REQUEST, 'name or source required')
        parent = parent ? await urlToNodeOriginal(parent) : vfs
        if (!parent)
            return new ApiError(HTTP_NOT_FOUND, 'parent not found')
        if (!await nodeIsDirectory(parent))
            return new ApiError(HTTP_NOT_ACCEPTABLE, 'parent not a folder')
        if (isWindowsDrive(source))
            source += '\\' // slash must be included, otherwise it will refer to the cwd of that drive
        const child = { source, name }
        name = getNodeName(child) // could be not given as input
        const ext = extname(name)
        const noExt = ext ? name.slice(0, -ext.length) : name
        let idx = 2
        while (parent.children?.find(isSameFilenameAs(name)))
            name = `${noExt} ${idx++}${ext}`
        child.name = name
        ;(parent.children ||= []).unshift({ source, name })
        await saveVfs()
        return { name }
    },

    async del_vfs({ uris }) {
        if (!uris || !Array.isArray(uris))
            return new ApiError(HTTP_BAD_REQUEST, 'invalid uris')
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
        return { path }
    },

    async *ls({ path, files=true, fileMask }, ctx) {
        if (!path && IS_WINDOWS) {
            try {
                for (const n of await getDrives())
                    yield { add: { n, k: 'd' } }
            }
            catch(error) {
                console.debug(error)
            }
            return
        }
        try {
            const matching = makeMatcher(fileMask)
            path = isWindowsDrive(path) ? path + '\\' : resolve(path || '/')
            for await (const [name, isDir] of dirStream(path)) {
                if (ctx.req.aborted)
                    return
                try {
                    if (!isDir)
                        if (!files || fileMask && !matching(name))
                            continue
                    const stats = await stat(join(path, name))
                    yield {
                        add: {
                            n: name,
                            s: stats.size,
                            c: stats.ctime,
                            m: stats.mtime,
                            k: isDir ? 'd' : undefined,
                        }
                    }
                }
                catch {} // just ignore entries we can't stat
            }
        } catch (e: any) {
            yield { error: e.code || e.message || String(e) }
        }
    }

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
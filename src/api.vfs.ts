// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defaultPerms, getNodeName, isSameFilenameAs, nodeIsDirectory, saveVfs, urlToNode, vfs, VfsNode } from './vfs'
import _ from 'lodash'
import { stat } from 'fs/promises'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { dirname, join, resolve } from 'path'
import { dirStream, isWindowsDrive, matches, newObj } from './misc'
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
            root: vfs && await recur(vfs),
            defaultPerms,
        }

        async function recur(node: VfsNode): Promise<VfsAdmin> {
            const stats: false | Stats = Boolean(node.source) && await stat(node.source!).catch(e => false)
            const isDir = !node.source || stats && stats.isDirectory()
            const copyStats: Pick<VfsAdmin, 'size' | 'ctime' | 'mtime'> = stats ? _.pick(stats, ['size', 'ctime', 'mtime'])
                : { size: node.source ? -1 : undefined }
            if (copyStats.mtime && Number(copyStats.mtime) === Number(copyStats.ctime))
                delete copyStats.mtime
            const isRoot = node === vfs
            return {
                ...copyStats,
                ...node,
                website: Boolean(node.children?.find(isSameFilenameAs('index.html')))
                    || isDir && node.source && await stat(join(node.source, 'index.html')).then(() => true, () => undefined)
                    || undefined,
                name: isRoot ? undefined : getNodeName(node),
                type: isDir ? 'folder' : undefined,
                children: node.children && await Promise.all(node.children.map(recur)),
            }
        }
    },

    async move_vfs({ from, parent }) {
        if (from <= '/' || !parent)
            return new ApiError(HTTP_BAD_REQUEST)
        const fromNode = await urlToNodeOriginal(from)
        if (!fromNode)
            return new ApiError(HTTP_NOT_FOUND, 'from not found')
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
        props = pickProps(props, ['name','source','masks','default', 'accept', ...Object.keys(defaultPerms)])
        if (props.name && props.name !== getNodeName(n)) {
            const parent = await urlToNodeOriginal(dirname(uri))
            if (parent?.children?.find(x => getNodeName(x) === props.name))
                return new ApiError(HTTP_CONFLICT, 'name already present')
        }
        props = newObj(props, v => v === null ? undefined : v) // null is a way to serialize undefined, that will restore default values
        if (props.masks && typeof props.masks !== 'object')
            delete props.masks
        Object.assign(n, props)
        if (getNodeName(_.omit(n, ['name'])) === n.name)  // name only if necessary
            n.name = undefined
        await saveVfs()
        return n
    },

    async add_vfs({ parent, source, name }) {
        const n = parent ? await urlToNodeOriginal(parent) : vfs
        if (!n)
            return new ApiError(HTTP_NOT_FOUND, 'invalid parent')
        if (n.isTemp || !await nodeIsDirectory(n))
            return new ApiError(HTTP_NOT_ACCEPTABLE, 'invalid parent')
        if (isWindowsDrive(source))
            source += '\\' // slash must be included, otherwise it will refer to the cwd of that drive
        n.children ||= []
        const sameName = name && isSameFilenameAs(name)
        if (n.children.find(x => source && source === x.source || sameName?.(x)))
            return new ApiError(HTTP_CONFLICT, 'already present')
        n.children.unshift({ source, name })
        await saveVfs()
        return {}
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
            while (path && !await stat(path).then(x => x.isDirectory(), () => 0))
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
            path = isWindowsDrive(path) ? path + '\\' : resolve(path || '/')
            for await (const [name, isDir] of dirStream(path)) {
                if (ctx.req.aborted)
                    return
                try {
                    if (!isDir)
                        if (!files || fileMask && !matches(name, fileMask))
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
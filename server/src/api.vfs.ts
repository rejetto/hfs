// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getNodeName, nodeIsDirectory, saveVfs, urlToNode, vfs, VfsNode } from './vfs'
import _ from 'lodash'
import { stat } from 'fs/promises'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { dirname, join } from 'path'
import { dirStream, enforceFinal, isWindowsDrive, objSameKeys } from './misc'
import { exec } from 'child_process'
import { promisify } from 'util'
import { FORBIDDEN, IS_WINDOWS } from './const'

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
        return { root: vfs && await recur(vfs) }

        async function recur(node: VfsNode): Promise<VfsAdmin> {
            const dir = await nodeIsDirectory(node)
            const stats: Pick<VfsAdmin, 'size' | 'ctime' | 'mtime'> = {}
            try {
                if (node.source && !dir)
                    Object.assign(stats, _.pick(await stat(node.source), ['size', 'ctime', 'mtime']))
            }
            catch {
                stats.size = -1
            }
            if (stats && Number(stats.mtime) === Number(stats.ctime))
                delete stats.mtime
            const isRoot = node === vfs
            return {
                ...stats,
                ...node,
                website: dir && node.source && await stat(join(node.source, 'index.html')).then(() => true, () => undefined)
                    || undefined,
                name: isRoot ? undefined : getNodeName(node),
                type: dir ? 'folder' : undefined,
                children: node.children && await Promise.all(node.children.map(recur)),
            }
        }
    },

    async set_vfs({ uri, props }) {
        const n = await urlToNodeOriginal(uri)
        if (!n)
            return new ApiError(404, 'path not found')
        props = pickProps(props, ['name','source','can_see','can_read','masks','default'])
        props = objSameKeys(props, v => v === null ? undefined : v) // null is a way to serialize undefined, that will restore default values
        if (props.masks && typeof props.masks !== 'object')
            delete props.masks
        Object.assign(n, props)
        if (getNodeName(_.omit(n, ['name'])) === n.name)  // name only if necessary
            n.name = undefined
        await saveVfs()
        return n
    },

    async add_vfs({ under, source, name }) {
        const n = under ? await urlToNodeOriginal(under) : vfs
        if (!n)
            return new ApiError(404, 'invalid under')
        if (n.isTemp || !await nodeIsDirectory(n))
            return new ApiError(FORBIDDEN, 'invalid under')
        const a = n.children || (n.children = [])
        if (source && a.find(x => x.source === source))
            return new ApiError(409, 'already present')
        a.unshift({ source, name })
        await saveVfs()
        return {}
    },

    async del_vfs({ uris }) {
        if (!uris || !Array.isArray(uris))
            return new ApiError(400, 'invalid uris')
        return {
            errors: await Promise.all(uris.map(async uri => {
                if (typeof uri !== 'string')
                    return 400
                const node = await urlToNodeOriginal(uri)
                if (!node)
                    return 404
                const parent = dirname(uri)
                const parentNode = await urlToNodeOriginal(parent)
                if (!parentNode)
                    return FORBIDDEN
                const { children } = parentNode
                if (!children) // shouldn't happen
                    return 500
                const idx = children.indexOf(node)
                children.splice(idx, 1)
                saveVfs()
                return 0 // error code 0 is OK
            }))
        }
    },

    async get_cwd() {
        return { path: process.cwd() }
    },

    async *ls({ path }, ctx) {
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
            if (isWindowsDrive(path))
                path = enforceFinal('/', path)
            for await (const name of dirStream(path)) {
                if (ctx.req.aborted)
                    return
                try {
                    const full = join(path, name)
                    const stats = await stat(full)
                    yield {
                        add: {
                            n: name,
                            s: stats.size,
                            c: stats.ctime,
                            m: stats.mtime,
                            k: stats.isDirectory() ? 'd' : undefined,
                        }
                    }
                }
                catch {} // just ignore entries we can't stat
            }
        } catch (e) {
            if ((e as any).code !== 'ENOTDIR')
                throw e
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
                ret[k] = o[k] === null && o[k] === '' ? undefined : o[k]
    return ret
}

async function getDrives() {
    const { stdout } = await promisify(exec)('wmic logicaldisk get name')
    return stdout.split('\n').slice(1).map(x => x.trim()).filter(Boolean)
}

import { getNodeName, nodeIsDirectory, saveVfs, vfs, VfsNode } from './vfs'
import _ from 'lodash'
import { stat } from 'fs/promises'
import { ApiError, ApiHandlers } from './apis'
import { dirname, join } from 'path'
import glob  from 'fast-glob'
import { enforceFinal, isWindows, isWindowsDrive } from './misc'
import { exec } from 'child_process'
import { promisify } from 'util'

type VfsAdmin = {
    type?: string,
    size?: number,
    ctime?: Date,
    mtime?: Date,
    children?: VfsAdmin[]
} & Omit<VfsNode, 'type' | 'children'>

const apis: ApiHandlers = {

    async get_vfs() {
        return { root: vfs.root && await recur(vfs.root) }

        async function recur(n: typeof vfs.root): Promise<VfsAdmin> {
            const dir = await nodeIsDirectory(n)
            const stats: Pick<VfsAdmin, 'size' | 'ctime' | 'mtime'> = {}
            try {
                if (n.source && !dir)
                    Object.assign(stats, _.pick(await stat(n.source), ['size', 'ctime', 'mtime']))
            }
            catch {
                stats.size = -1
            }
            if (stats && Number(stats.mtime) === Number(stats.ctime))
                delete stats.mtime
            return {
                ...stats,
                ...n,
                name: getNodeName(n),
                type: dir ? 'folder' : undefined,
                children: n.children && await Promise.all(n.children.map(recur)),
            }
        }
    },

    async set_vfs({ uri, props }) {
        const n = await vfs.urlToNode(uri)
        if (!n)
            return new ApiError(404, 'path not found')
        Object.assign(n, pickProps(props, ['name','source','hidden','forbid','perm','hide','remove']))
        if (getNodeName(_.omit(n, ['name'])) === n.name)  // name only if necessary
            delete n.name
        await saveVfs()
        return n
    },

    async add_vfs({ under, source, name }) {
        const n = under ? await vfs.urlToNode(under) : vfs.root
        if (!n)
            return new ApiError(404, 'invalid under')
        if (n.isTemp || !await nodeIsDirectory(n))
            return new ApiError(403, 'invalid under')
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
                const node = await vfs.urlToNode(uri)
                if (!node || node.isTemp)
                    return 404
                const parent = dirname(uri)
                const parentNode = await vfs.urlToNode(parent)
                if (!parentNode)
                    return 403
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
        if (!path && isWindows()) {
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
            const dirStream = glob.stream('*', {
                cwd: path,
                dot: true,
                onlyFiles: false,
                suppressErrors: true,
            })
            for await (let name of dirStream) {
                if (ctx.req.aborted)
                    return
                if (name instanceof Buffer)
                    name = name.toString('utf8')
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

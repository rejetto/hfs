import { vfs, VfsNode, walkNode } from './vfs'
import createSSE from './sse'
import { basename } from 'path'
import { ApiError, ApiHandler } from './apis'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { pattern2filter } from './misc'
import { FORBIDDEN } from './const'

export const file_list:ApiHandler = async ({ path, offset, limit, search, omit, sse }, ctx) => {
    let node = await vfs.urlToNode(path || '/', ctx)
    if (!node)
        return
    if (node.forbid)
        return new ApiError(FORBIDDEN)
    if (search?.includes('..'))
        return new ApiError(400)
    if (node.default)
        return { redirect: path }
    offset = Number(offset)
    limit = Number(limit)
    const filter = pattern2filter(search)
    const walker = walkNode(node, ctx, search ? Infinity : 0)
    const sseSrv = sse ? createSSE(ctx) : null
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    const res = produceEntries()
    return !sseSrv && { list: await res }

    async function produceEntries() {
        const list = []
        for await (const sub of walker) {
            if (sseSrv?.stopped || ctx.aborted) break
            if (!filter(sub.name))
                continue
            const entry = await nodeToDirEntry(sub)
            if (!entry)
                continue
            const cbParams = { entry, ctx, listPath:path, node:sub }
            try {
                if (onDirEntryHandlers.some(cb => cb(cbParams) === false))
                    continue
            }
            catch(e) {
                console.log('a plugin with onDirEntry is causing problems:', e)
            }
            if (offset) {
                --offset
                continue
            }
            if (omit) {
                if (omit !== 'c')
                    ctx.throw(400, 'omit')
                if (!entry.m)
                    entry.m = entry.c
                delete entry.c
            }
            if (sseSrv)
                sseSrv.send({ entry })
            else
                list.push(entry)
            if (limit && !--limit)
                break
        }
        sseSrv?.close()
        return list
    }
}

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date }

async function nodeToDirEntry(node: VfsNode): Promise<DirEntry | null> {
    try {
        let { name, source, default:def } = node
        if (source?.includes('//'))
            return { n: name || source }
        if (source) {
            if (!name)
                name = basename(source)
            if (def)
                return { n: name }
            const st = await stat(source)
            const folder = st.isDirectory()
            const { ctime, mtime } = st
            return {
                n: name + (folder ? '/' : ''),
                c: ctime,
                m: Math.abs(+mtime-+ctime) < 1000 ? undefined : mtime,
                s: folder ? undefined : st.size,
            }
        }
        return name ? { n: name + '/' } : null
    }
    catch (err:any) {
        console.error(String(err))
        return null
    }
}

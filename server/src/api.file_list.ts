// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { cantReadStatusCode, getNodeName, hasPermission, urlToNode, VfsNode, walkNode } from './vfs'
import { ApiError, ApiHandler } from './apiMiddleware'
import { stat } from 'fs/promises'
import { mapPlugins } from './plugins'
import { asyncGeneratorToArray, asyncGeneratorToReadable, dirTraversal, filterMapGenerator, pattern2filter } from './misc'

export const file_list:ApiHandler = async ({ path, offset, limit, search, omit, sse }, ctx) => {
    let node = await urlToNode(path || '/', ctx)
    if (!node)
        return new ApiError(404)
    if (!hasPermission(node,'can_read',ctx))
        return new ApiError(cantReadStatusCode(node))
    if (dirTraversal(search))
        return new ApiError(418)
    if (node.default)
        return { redirect: path }
    offset = Number(offset)
    limit = Number(limit)
    const filter = pattern2filter(search)
    const walker = walkNode(node, ctx, search ? Infinity : 0)
    const onDirEntryHandlers = mapPlugins(plug => plug.onDirEntry)
    return sse ? asyncGeneratorToReadable(
            filterMapGenerator(produceEntries(), async (entry) => ({ entry })) // wrap entry in an object
        )
        : { list: await asyncGeneratorToArray(produceEntries()) }

    async function* produceEntries() {
        for await (const sub of walker) {
            if (ctx.aborted) break
            if (!filter(getNodeName(sub)))
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
            yield entry
            if (limit && !--limit)
                break
        }
    }
}

export interface DirEntry { n:string, s?:number, m?:Date, c?:Date }

async function nodeToDirEntry(node: VfsNode): Promise<DirEntry | null> {
    let { source, default:def } = node
    const name = getNodeName(node)
    if (!source)
        return name ? { n: name + '/' } : null
    if (def)
        return { n: name }
    try {
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
    catch {
        return null
    }
}

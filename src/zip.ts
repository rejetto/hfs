// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getNodeName, hasPermission, nodeIsDirectory, nodeIsLink, urlToNode, VfsNode, walkNode } from './vfs'
import Koa from 'koa'
import { filterMapGenerator, isWindowsDrive, pattern2filter, wantArray } from './misc'
import { QuickZipStream } from './QuickZipStream'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { defineConfig } from './config'
import { basename, dirname } from 'path'
import { getRange } from './serveFile'
import { HTTP_OK } from './const'

// expects 'node' to have had permissions checked by caller
export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    ctx.status = HTTP_OK
    ctx.mime = 'zip'
    // ctx.query.list is undefined | string | string[]
    const list = wantArray(ctx.query.list)[0]?.split('*') // we are using * as separator because it cannot be used in a file name and doesn't need url encoding
    const name = list?.length === 1 ? decodeURIComponent(basename(list[0]!)) : getNodeName(node)
    ctx.attachment((isWindowsDrive(name) ? name[0] : (name || 'archive')) + '.zip')
    const filter = pattern2filter(String(ctx.query.search||''))
    const walker = !list ? walkNode(node, ctx, Infinity, '', 'can_archive')
        : (async function*(): AsyncIterableIterator<VfsNode> {
            for await (const uri of list) {
                const subNode = await urlToNode(uri, ctx, node)
                if (!subNode)
                    continue
                if (await nodeIsDirectory(subNode)) { // a directory needs to walked
                    if (hasPermission(subNode, 'can_list',ctx)) {
                        yield subNode // it could be empty
                        yield* walkNode(subNode, ctx, Infinity, decodeURI(uri) + '/', 'can_archive')
                    }
                    continue
                }
                let folder = dirname(decodeURIComponent(uri)) // decodeURI() won't account for %23=#
                folder = folder === '.' ? '' : folder + '/'
                yield { ...subNode, name: folder + getNodeName(subNode) } // reflect relative path in archive, otherwise way may have name-clashes
            }
        })()
    const mappedWalker = filterMapGenerator(walker, async (el:VfsNode) => {
        if (nodeIsLink(el)) return
        if (!hasPermission(el, 'can_archive', ctx)) return // the fact you see it doesn't mean you can get it
        const { source } = el
        const name = getNodeName(el)
        if (ctx.req.aborted || !filter(name))
            return
        try {
            if (el.isFolder)
                return { path: name + '/' }
            if (!source) return
            const st = await fs.stat(source)
            if (!st || !st.isFile())
                return
            return {
                path: name,
                size: st.size,
                ts: st.mtime || st.ctime,
                mode: st.mode,
                sourcePath: source,
                getData: () => createReadStream(source, { start: 0 , end: Math.max(0, st.size-1) })
            }
        }
        catch {}
    })
    const zip = new QuickZipStream(mappedWalker)
    const time = 1000 * zipSeconds.get()
    const size = await zip.calculateSize(time)
    ctx.response.length = size
    const range = getRange(ctx, size) // keep var size as ctx.response.length won't preserve a NaN
    if (ctx.status >= 400)
        return
    if (range)
        zip.applyRange(range.start, range.end)
    ctx.body = zip
    ctx.req.on('close', ()=> zip.destroy())
    ctx.state.archive = 'zip'
}

const zipSeconds = defineConfig('zip_calculate_size_for_seconds', 1)

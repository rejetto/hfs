// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getNodeName, hasPermission, nodeIsDirectory, nodeIsLink, urlToNode, VfsNode, walkNode, statusCodeForMissingPerm } from './vfs'
import Koa from 'koa'
import { filterMapGenerator, isWindowsDrive, pattern2filter, safeDecodeURIComponent, wantArray } from './misc'
import { QuickZipStream } from './QuickZipStream'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { defineConfig } from './config'
import { basename, dirname } from 'path'
import { applyRange, forceDownload, monitorAsDownload } from './serveFile'
import { HTTP_OK } from './const'

// expects 'node' to have had permissions checked by caller
export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    const list = wantArray(ctx.query.list)[0]?.split('*') // we are using * as separator because it cannot be used in a file name and doesn't need url encoding
    if (!list && statusCodeForMissingPerm(node, 'can_archive', ctx)) return
    ctx.status = HTTP_OK
    ctx.mime = 'zip'
    // ctx.query.list is undefined | string | string[]
    const name = list?.length === 1 ? safeDecodeURIComponent(basename(list[0]!)) : getNodeName(node)
    forceDownload(ctx, (isWindowsDrive(name) ? name[0] : (name || 'archive')) + '.zip')
    const filter = pattern2filter(String(ctx.query.search||''))
    const walker = !list ? walkNode(node, { ctx, requiredPerm: 'can_archive' })
        : (async function*(): AsyncIterableIterator<VfsNode> {
            for await (const uri of list) {
                const subNode = await urlToNode(uri, ctx, node)
                if (!subNode)
                    continue
                if (await nodeIsDirectory(subNode)) { // a directory needs to walked
                    if (hasPermission(subNode, 'can_list', ctx) && hasPermission(subNode, 'can_archive', ctx)) {
                        yield subNode // it could be empty
                        yield* walkNode(subNode, { ctx, prefixPath: decodeURI(uri) + '/', requiredPerm: 'can_archive' })
                    }
                    continue
                }
                let folder = dirname(safeDecodeURIComponent(uri)) // decodeURI() won't account for %23=#
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
            const st = el.stats || await fs.stat(source)
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
    const range = applyRange(ctx, size) // keep var size as ctx.response.length won't preserve a NaN
    if (ctx.status >= 400)
        return
    if (range)
        zip.applyRange(range.start, range.end)
    ctx.body = zip
    ctx.req.on('close', ()=> zip.destroy())
    ctx.state.archive = 'zip'
    monitorAsDownload(ctx, size, range?.start)
}

const zipSeconds = defineConfig('zip_calculate_size_for_seconds', 1)

declare module "koa" {
    interface DefaultState {
        archive?: string
    }
}
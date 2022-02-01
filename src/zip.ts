import { getNodeName, nodeIsDirectory, vfs, VfsNode, walkNode } from './vfs'
import Koa from 'koa'
import { filterMapGenerator, pattern2filter, prefix } from './misc'
import { QuickZipStream } from './QuickZipStream'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { getConfig } from './config'
import { dirname } from 'path'

export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    ctx.status = 200
    ctx.mime = 'zip'
    const name = getNodeName(node)
    ctx.attachment((name || 'archive') + '.zip')
    const filter = pattern2filter(String(ctx.query.search||''))
    const { list } = ctx.query
    const walker = !list ? walkNode(node, ctx, Infinity)
        : (async function*(): AsyncIterableIterator<VfsNode> {
            for (const el of String(list).split('*')) { // we are using * as separator because it cannot be used in a file name and doesn't need url encoding
                const subNode = await vfs.urlToNode(el, ctx, node)
                if (!subNode)
                    continue
                if (await nodeIsDirectory(subNode)) // a directory needs to walked
                    yield* walkNode(subNode, ctx, Infinity, el+'/')
                else
                    yield {  ...subNode, name: prefix('', dirname(el), '/') + getNodeName(subNode) } // reflect relative path in archive, otherwise way may have name-clashes
            }
        })()
    const mappedWalker = filterMapGenerator(walker, async (el:VfsNode) => {
        const { source } = el
        const name = getNodeName(el)
        if (!source || ctx.req.aborted || !filter(name))
            return
        try {
            const st = await fs.stat(source)
            if (!st || !st.isFile())
                return
            return {
                path: name,
                size: st.size,
                ts: st.mtime || st.ctime,
                getData: () => createReadStream(source)
            }
        }
        catch {}
    })
    const zip = new QuickZipStream(mappedWalker)
    const time = 1000 * (getConfig('zip_calculate_size_for_seconds') ?? 1)
    ctx.response.length = await zip.calculateSize(time)
    ctx.body = zip
    ctx.req.on('close', ()=> zip.destroy())
}

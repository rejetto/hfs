import { VfsNode, walkNode } from './vfs'
import { getCurrentUsernameExpanded } from './perm'
import Koa from 'koa'
import archiver from 'archiver'
import { isFile } from './misc'

export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    ctx.status = 200
    ctx.mime = 'zip'
    const { name } = node
    ctx.attachment(name+'.zip')
    const who = await getCurrentUsernameExpanded(ctx) // cache value
    const walker = walkNode(node, who, Infinity)
    const archive = ctx.body = archiver('zip', { store: true })
    for await (const { source, name } of walker)
        if (source && await isFile(source))
            archive.file(source, { name })
    archive.finalize().then()
}

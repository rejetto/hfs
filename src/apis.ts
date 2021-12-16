import Koa from 'koa'
import { vfs, VfsNode } from './vfs'
import { globDir } from './misc'
import { Stats } from 'fs'
import { stat } from 'fs/promises'
import _ from 'lodash'

type ApiHandler = (params?:any, ctx?:any) => any
type ApiHandlers = Record<string, ApiHandler>

export function apiMw(apis: ApiHandlers) : Koa.Middleware {
    return async (ctx, next) => {
        const params = ctx.request.body
        console.debug('API', ctx.method, ctx.path, params)
        // @ts-ignore
        ctx.assert(ctx.path in apis, 404, 'invalid api')
        const cb = (apis as any)[ctx.path]
        const res = await cb(params, ctx)
        if (res)
            ctx.body = res
        await next()
    }
}

export const frontEndApis: ApiHandlers = {
    async file_list(params:any) {
        let node = await vfs.urlToNode(params.path || '/')
        if (!node)
            return
        const list = await Promise.all((node.children ||[]).map(node =>
            !node.hidden && nodeToFile(node) ))
        _.remove(list, x => !x)
        let path = node.source
        if (path) {
            const res = await globDir(path, [node.hide, node.remove])
            list.push( ...res.map(x => statToFile(node!.rename?.[x.name] || x.name, x.stats!)) )
        }
        return { list }
    }
}

async function nodeToFile(node: VfsNode) {
    try {
        return node.source?.includes('//') ? { n:node.name }
            : node.source ? statToFile(node.name, await stat(node.source))
                : node.name ? { n: node.name + '/' }
                    : null
    }
    catch (err:any) {
        console.error('ERR', node.source, err?.code || err)
        return null
    }
}

function statToFile(name: string | undefined, stat:Stats) {
    const folder = stat.isDirectory()
    return {
        n: name + (folder ? '/' : ''),
        c: stat?.ctime,
        m: stat?.mtime,
        s: folder ? undefined : stat?.size,
    }
}

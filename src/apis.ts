import glob from 'fast-glob'
import Koa from 'koa'
import { vfs, VfsNode } from './vfs'
import { enforceFinal, wantArray } from './misc'
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
        let node = vfs.urlToNode(params.path || '/')
        if (!node)
            return
        const list = await Promise.all((node.children ||[]).map(async (node:VfsNode) =>
            node.hidden ? null
                : node.source ? stat(node.source).then(res => statToFile(node.name, res), () => null)
                    : node.name ? { n: node.name + '/' }
                        : null
        ))
        _.remove(list, x => !x)
        let path = node.source
        if (path) {
            // using / because trying path.join broke glob() on my Windows machine
            path = enforceFinal('/', glob.escapePath(path.replace(/\\/g,'/')))
            const res = await glob(path + '*', {
                stats: true,
                dot: true,
                markDirectories: true,
                onlyFiles: false,
                ignore: wantArray(node.hide).map(x => path+x),
            })
            const { rename } = node
            list.push( ...res.map(x => statToFile(rename?.[x.name] || x.name, x.stats!)) )
        }
        return { list }
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

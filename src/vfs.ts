import Koa from 'koa'
import yaml from 'yaml'
import fs, { createReadStream } from 'fs'
import { basename } from 'path'

enum VfsNodeType {
    root,
}

interface VfsNode {
    type?: VfsNodeType,
    name?: string,
    source?: string,
    children?: VfsNode[]
}

class Vfs {
    root: VfsNode = {}

    load(path: string, watch:boolean=true) {
        const data = fs.readFileSync(path, 'utf8')
        this.root = yaml.parse(data)
        if (!this.root)
            throw `Couldn't load ${path}`
        this.root.type = VfsNodeType.root
        recur(this.root)
        if (watch)
            fs.watch(path, () => vfs.load(path))

        function recur(node:VfsNode) {
            if (node.type !== VfsNodeType.root && !node.name && node.source)
                node.name = basename(node.source)
            node.children?.forEach(recur)
        }
    }

    urlToNode(url: string) {
        let run = this.root
        const rest = url.split('/').filter(Boolean)
        while (rest.length) {
            const piece = rest[0]
            // @ts-ignore
            const find = run?.children?.find(x => x.name === piece)
            if (!find)
                return run.source ? { source:run.source + '/' + rest.join('/') } : null
            run = find
            rest.shift()
        }
        return run
    }
}

export function serveFileFromVfs() : Koa.Middleware {
    return async (ctx, next) => {
        let { url } = ctx
        const path = vfs.urlToNode(decodeURI(url))?.source
        if (path)
            ctx.body = createReadStream(path as string)
        await next()
    }
}

export const vfs = new Vfs()
vfs.load('vfs.yaml')

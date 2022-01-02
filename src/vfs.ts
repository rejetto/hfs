import fs from 'fs/promises'
import { basename } from 'path'
import { isMatch } from 'micromatch'
import { complySlashes, enforceFinal, isDirectory, prefix, wantArray } from './misc'
import { getCurrentUsernameExpanded } from './perm'
import Koa from 'koa'
import glob from 'fast-glob'
import _ from 'lodash'
import { subscribe } from './config'

export enum VfsNodeType {
    root,
    temp,
}

export interface VfsNode {
    type?: VfsNodeType,
    name: string,
    source?: string,
    children?: VfsNode[],
    hide?: string | string[],
    remove?: string | string[],
    hidden?: boolean,
    rename?: Record<string,string>,
    perm?: Record<string, SinglePerm>,
    default?: string,
    mime?: string
}

type SinglePerm = 'r' | 'w'

const EMPTY = { name:'', type: VfsNodeType.root }

export const MIME_AUTO = 'auto'

export class Vfs {
    root: VfsNode = { ...EMPTY }

    reset(){
        this.root = { ...EMPTY }
    }

    async urlToNode(url: string, ctx: Koa.Context) : Promise<VfsNode | undefined> {
        const users = await getCurrentUsernameExpanded(ctx)
        let run = this.root
        const rest = url.split('/').filter(Boolean).map(decodeURIComponent)
        if (forbidden(run, users)) return
        while (rest.length) {
            let piece = rest.shift() as string
            const child = findChildByName(piece, run)
            if (child) {
                run = child
                if (forbidden(run, users)) return
                continue
            }
            if (!run.source)
                return
            const relativeSource = piece + prefix('/', rest.join('/'))
            const baseSource = run.source+ '/'
            const source = baseSource + relativeSource
            if (isMatch(source, wantArray(run.remove).map(x => baseSource + x)))
                return
            try { await fs.stat(source) } // check existence
            catch(e){ return }
            return {
                source,
                name: basename(source),
                mime: run.mime || (run.default && MIME_AUTO)
            }
        }
        return run
    }

}

export const vfs = new Vfs()
subscribe('vfs', data => {
    // we should validate content now
    recur(data)
    vfs.root = data

    function recur(node:VfsNode) {
        if (node.type !== VfsNodeType.root && !node.name && node.source)
            node.name = basename(node.source)
        node.children?.forEach(recur)
    }
})

function findChildByName(name:string, node:VfsNode) {
    const { rename } = node
    if (rename) // @ts-ignore
        name = Object.entries(rename).find(([,v]) => name === v)[0] || name
    return node?.children?.find(x => x.name === name)
}

export function forbidden(node:VfsNode, users:string[]) {
    const { perm } = node
    return perm && !users.some(u => perm[u])
}


export async function* walkNode(parent:VfsNode, ctx: Koa.Context, depth:number=0, prefixPath:string=''): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    ctx._who = ctx._who || await getCurrentUsernameExpanded(ctx) // cache value
    if (children)
        for (const c of children) {
            if (c.hidden || forbidden(c, ctx._who))
                continue
            yield prefixPath ? { ...c, name: prefixPath+c.name } : c
            if (depth > 0 && c && (c.children || c.source && await isDirectory(c.source)))
                yield* walkNode(c, ctx, depth - 1, prefixPath+c.name+'/')
        }
    if (!source)
        return
    const base = enforceFinal('/', complySlashes(source)) // fast-glob lib wants forward-slashes
    const baseForGlob = glob.escapePath(base)
    const ignore = [parent.hide, parent.remove].flat().filter(Boolean).map(x => baseForGlob+x)
    const depthPath = depth === Infinity ? '**/' : _.repeat('*/',depth)
    try {
        const dirStream = glob.stream(baseForGlob + depthPath + '*', {
            dot: true,
            onlyFiles: false,
            ignore,
        })
        for await (let path of dirStream) {
            if (ctx.req.aborted)
                return
            if (path instanceof Buffer)
                path = path.toString('utf8')
            const name = path.slice(base.length)
            yield {
                type: VfsNodeType.temp,
                source: path,
                name: prefixPath + (parent!.rename?.[name] || name)
            }
        }
    }
    catch(e) {
        if ((e as any).code !== 'ENOTDIR')
            throw e
    }
}

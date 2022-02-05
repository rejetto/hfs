import fs from 'fs/promises'
import { basename } from 'path'
import { isMatch } from 'micromatch'
import { enforceFinal, isDirectory, isWindows, onlyTruthy, prefix } from './misc'
import Koa from 'koa'
import glob from 'fast-glob'
import _ from 'lodash'
import { subscribeConfig } from './config'

export enum VfsNodeType {
    root,
    temp,
}

export interface VfsNode {
    type?: VfsNodeType,
    name?: string,
    source?: string,
    children?: VfsNode[],
    hide?: string,
    remove?: string,
    hidden?: boolean,
    forbid?: boolean,
    rename?: Record<string,string>,
    perm?: Record<string, SinglePerm>,
    default?: string,
    mime?: string
}

type SinglePerm = 'r' | 'w'

const EMPTY = { type: VfsNodeType.root }

export const MIME_AUTO = 'auto'

export class Vfs {
    root: VfsNode = { ...EMPTY }

    reset(){
        this.root = { ...EMPTY }
    }

    async urlToNode(url: string, ctx?: Koa.Context, root?: VfsNode) : Promise<VfsNode | undefined> {
        let run = root || this.root
        const rest = url.split('/').filter(Boolean).map(decodeURIComponent)
        if (ctx && !hasPermission(run, ctx)) return
        while (rest.length) {
            let piece = rest.shift() as string
            const child = findChildByName(piece, run)
            if (child) {
                run = child
                if (ctx && !hasPermission(run, ctx)) return
                continue
            }
            if (!run.source)
                return
            const relativeSource = piece + prefix('/', rest.join('/'))
            const baseSource = run.source+ '/'
            const source = baseSource + relativeSource
            if (run.remove && isMatch(source, run.remove.split('|').map(x => baseSource + x)))
                return
            try { await fs.stat(source) } // check existence
            catch { return }
            return {
                type: VfsNodeType.temp,
                source,
                mime: run.mime || (run.default && MIME_AUTO)
            }
        }
        return run
    }

}

export const vfs = new Vfs()
subscribeConfig<VfsNode>({ k: 'vfs' }, data =>
    vfs.root = data)

function findChildByName(name:string, node:VfsNode) {
    const { rename } = node
    if (rename) // @ts-ignore
        name = Object.entries(rename).find(([,v]) => name === v)[0] || name
    return node?.children?.find(x => getNodeName(x) === name)
}

export function getNodeName(node: VfsNode) {
    return node.name
        || node.source && /^[a-zA-Z]:$/.test(node.source) && node.source
        || basename(node.source||'')
}

export async function nodeIsDirectory(node: VfsNode) {
    return Boolean(!node.source || await isDirectory(node.source))
}

export function hasPermission(node:VfsNode, ctx: Koa.Context) {
    const { perm } = node
    return !perm || ctx.state.usernames.some((u:string) => perm[u])
}

export async function* walkNode(parent:VfsNode, ctx: Koa.Context, depth:number=0, prefixPath:string=''): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    if (children)
        for (const node of children) {
            if (node.hidden || !hasPermission(node, ctx))
                continue
            yield prefixPath ? { ...node, name: prefixPath+getNodeName(node) } : node
            try {
                if (depth > 0 && node && await nodeIsDirectory(node))
                    yield* walkNode(node, ctx, depth - 1, prefixPath+getNodeName(node)+'/')
            }
            catch{} // stat failed in nodeIsDirectory, ignore
        }
    if (!source)
        return
    const depthPath = depth === Infinity ? '**/' : _.repeat('*/',depth)
    try {
        const dirStream = glob.stream(depthPath + '*', {
            dot: true,
            onlyFiles: false,
            cwd: source,
            suppressErrors: true,
            caseSensitiveMatch: !isWindows(),
            ignore: onlyTruthy([parent.hide, parent.remove]),
        })
        const base = enforceFinal('/', source)
        for await (let path of dirStream) {
            if (ctx.req.aborted)
                return
            if (path instanceof Buffer)
                path = path.toString('utf8')
            yield {
                type: VfsNodeType.temp,
                source: base + path,
                name: prefixPath + (parent!.rename?.[path] || path)
            }
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }
}

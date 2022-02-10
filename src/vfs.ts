import fs from 'fs/promises'
import { basename } from 'path'
import { isMatch } from 'micromatch'
import { dirTraversal, enforceFinal, isDirectory, isWindows, onlyTruthy } from './misc'
import Koa from 'koa'
import glob from 'fast-glob'
import _ from 'lodash'
import { setConfig, subscribeConfig } from './config'

export interface VfsNode {
    isTemp?: true, // this node was spawned by a source-d node and is not part of the vfs tree
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
    mime?: string,
}

type SinglePerm = 'r' | 'w'

export const MIME_AUTO = 'auto'

export class Vfs {
    root: VfsNode = {}

    reset(){
        this.root = {}
    }

    async urlToNode(url: string, ctx?: Koa.Context, root?: VfsNode) : Promise<VfsNode | undefined> {
        let run = root || this.root
        const decoded = decodeURI(url)
        if (dirTraversal(decoded)) {
            if (ctx)
                ctx.status = 418
            return
        }
        const rest = decoded.split('/').filter(Boolean)
        if (ctx && !hasPermission(run, ctx)) return
        while (rest.length) {
            const child = findChildByName(rest[0], run) // does the tree node have a child that goes by this name?
            if (child) { // yes
                rest.shift() // consume
                run = child // move cursor
                if (ctx && !hasPermission(run, ctx)) return
                continue // go on
            }
            // not in the tree, we can see consider continuing on the disk
            if (!run.source) return // but then we need the current node to be linked to the disk, otherwise, we give up
            const relativeSource = rest.join('/')
            const baseSource = run.source+ '/'
            const source = baseSource + relativeSource
            if (run.remove && isMatch(source, run.remove.split('|').map(x => baseSource + x)))
                return
            try { await fs.stat(source) } // check existence
            catch { return }
            return {
                isTemp: true,
                source,
                mime: run.mime || (run.default && MIME_AUTO)
            }
        }
        return run
    }

}

export const vfs = new Vfs()
subscribeConfig<VfsNode>({ k: 'vfs', defaultValue: vfs.root }, data =>
    vfs.root = data)

export function saveVfs() {
    return setConfig({ vfs: _.cloneDeep(vfs.root) }, true)
}

function findChildByName(name:string, node:VfsNode) {
    const { rename } = node
    if (rename) // @ts-ignore
        name = Object.entries(rename).find(([,v]) => name === v)[0] || name
    return node?.children?.find(x => getNodeName(x) === name)
}

export function getNodeName(node: VfsNode) {
    return node.name
        || node.source && (
            /^[a-zA-Z]:\\?$/.test(node.source) && node.source.slice(0, 2)
            || basename(node.source)
            || node.source
        )
        || '' // should happen only for root
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
        const base = enforceFinal('/', source)
        const dirStream = glob.stream(depthPath + '*', {
            dot: true,
            onlyFiles: false,
            cwd: base,
            suppressErrors: true,
            caseSensitiveMatch: !isWindows(),
            ignore: onlyTruthy([parent.hide, parent.remove]),
        })
        for await (let path of dirStream) {
            if (ctx.req.aborted)
                return
            if (path instanceof Buffer)
                path = path.toString('utf8')
            yield {
                isTemp: true,
                source: base + path,
                name: prefixPath + (parent!.rename?.[path] || path)
            }
        }
    }
    catch(e) {
        console.debug('glob', source, e) // ENOTDIR, or lacking permissions
    }
}

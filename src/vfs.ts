import { argv } from './const'
import yaml from 'yaml'
import fs from 'fs/promises'
import { FSWatcher, watch } from 'fs'
import { dirname, basename } from 'path'
import { isMatch } from 'micromatch'
import { complySlashes, enforceFinal, prefix, readFileBusy } from './misc'
import { getCurrentUser } from './perm'
import Koa from 'koa'
import glob from 'fast-glob'
import _ from 'lodash'

export enum VfsNodeType {
    root,
    temp,
}

export interface VfsNode {
    type?: VfsNodeType,
    name?: string,
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

const EMPTY = { type: VfsNodeType.root }

export const MIME_AUTO = 'auto'

export class Vfs {
    root: VfsNode = EMPTY
    watcher?: FSWatcher
    basePath: string

    constructor(path?:string) {
        this.basePath = ''
        if (path)
            this.load(path).then(()=>
                this.basePath = dirname(path))
        else
            this.reset()
    }

    reset(){
        this.root = { ...EMPTY }
    }

    async load(path: string, watchFile:boolean=true) {
        console.debug('loading',path)
        try {
            const data = await readFileBusy(path)
            this.root = yaml.parse(data)
            // we should validate content now
        }
        catch(e) {
            console.error(`Load failed for ${path}`,e)
        }
        this.watcher?.close()
        this.watcher = undefined
        recur(this.root)
        if (!watchFile) return
        let doing = false
        this.watcher = watch(path, async () => {
            if (doing) return
            doing = true
            try { await this.load(path).catch() }
            finally { doing = false }
        })

        function recur(node:VfsNode) {
            if (node.type !== VfsNodeType.root && !node.name && node.source)
                node.name = basename(node.source)
            node.children?.forEach(recur)
        }
    }

    async urlToNode(url: string, ctx: Koa.Context) : Promise<VfsNode | undefined> {
        const who = await getCurrentUser(ctx)
        let run = this.root
        const rest = url.split('/').filter(Boolean).map(decodeURIComponent)
        if (forbidden()) return
        while (rest.length) {
            let piece = rest.shift() as string
            const child = findChildByName(piece, run)
            if (child) {
                run = child
                if (forbidden()) return
                continue
            }
            if (!run.source)
                return
            const relativeSource = piece + prefix('/', rest.join('/'))
            const baseSource = run.source+ '/'
            const source = baseSource + relativeSource
            const removed = isMatch(source, [run.remove].flat().map(x => baseSource + x))
            return removed || !await fs.stat(source) ? undefined : { source, mime: run.mime || (run.default && MIME_AUTO) }
        }
        return run

        function forbidden() {
            const { perm } = run
            return perm && (!perm[who] || perm['*'])
        }

    }

}

export const vfs = new Vfs(argv._[0] || 'vfs.yaml')

function findChildByName(name:string, node:VfsNode) {
    const { rename } = node
    if (rename) // @ts-ignore
        name = Object.entries(rename).find(([,v]) => name === v)[0] || name
    return node?.children?.find(x => x.name === name)
}

export function directPermOnNode(node:VfsNode, username:string) {
    const { perm } = node
    return !perm ? 'r' : (username && perm[username] || perm['*'])
}


export async function* walkNode(parent:VfsNode, who:string, depth:number=0, prefixPath:string=''): AsyncIterableIterator<VfsNode> {
    const { children, source } = parent
    if (children)
        for (const c of children) {
            if (c.hidden || !directPermOnNode(c,who))
                continue
            yield prefixPath ? { ...c, name: prefixPath+c.name } : c
            if (depth > 0 && c)
                yield* walkNode(c, '', depth - 1, prefixPath+c.name+'/')
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

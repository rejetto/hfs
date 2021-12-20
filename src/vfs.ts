import { argv } from './const'
import yaml from 'yaml'
import fs from 'fs/promises'
import { FSWatcher, watch } from 'fs'
import { dirname, basename } from 'path'
import { isMatch } from 'micromatch'
import { complySlashes, prefix } from './misc'
import { getCurrentUser } from './perm'
import Koa from 'koa'

enum VfsNodeType {
    root,
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
    perm?: Record<string, SinglePerm>
}

type SinglePerm = 'r' | 'w'

const EMPTY = { type: VfsNodeType.root }

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
            const data = await fs.readFile(path, 'utf8')
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

    async urlToNode(url: string, ctx: Koa.Context) {
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
                return null
            const relativeSource = piece + prefix('/', rest.join('/'))
            const baseSource = complySlashes(run.source+ '/') //TODO do we really need complySlashes here?
            const source = baseSource + relativeSource
            const removed = isMatch(source, [run.remove].flat().map(x => baseSource + x))
            return removed || !await fs.stat(source) ? null : { source }
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

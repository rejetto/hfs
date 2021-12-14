import { argv } from './const'
import yaml from 'yaml'
import fs from 'fs/promises'
import { FSWatcher, watch } from 'fs'
import { basename } from 'path'

enum VfsNodeType {
    root,
}

export interface VfsNode {
    type?: VfsNodeType,
    name?: string,
    source?: string,
    children?: VfsNode[],
    hide?: string | string[],
}

export class Vfs {
    root: VfsNode = {}
    watcher?: FSWatcher

    constructor(path?:string) {
        if (path)
            this.load(path).then()
    }

    async load(path: string, watchFile:boolean=true) {
        console.debug('loading vfs')
        this.watcher?.close()
        const data = await fs.readFile(path, 'utf8')
        this.root = yaml.parse(data)
        if (!this.root)
            throw `Couldn't load ${path}`
        this.root.type = VfsNodeType.root
        recur(this.root)
        if (!watchFile) return
        let doing = false
        this.watcher = watch(path, async () => {
            if (doing) return
            doing = true
            await this.load(path)
            doing = false
        })

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

export const vfs = new Vfs(argv._[0])

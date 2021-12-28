import fs from 'fs/promises'
import { objSameKeys } from './obj'
import { watch } from 'fs'
import yaml from 'yaml'

export function enforceFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s : s+sub
}

export async function isDirectory(path: string) {
    try { return (await fs.stat(path)).isDirectory() }
    catch(e) { return false }
}

export async function isFile(path: string) {
    try { return (await fs.stat(path)).isFile() }
    catch(e) { return false }
}

export function complySlashes(path: string) {
    return path.replace(/\\/g,'/')
}

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

export function setHidden(dest: object, src:object) {
    Object.defineProperties(dest, objSameKeys(src, value => ({ enumerable:false, value })))
}

export function wait(ms: number) {
    return new Promise(res=> setTimeout(res,ms))
}

export async function readFileBusy(path: string): Promise<string> {
    return fs.readFile(path, 'utf8').catch(e => {
        if ((e as any)?.code !== 'EBUSY')
            throw e
        console.debug('busy')
        return wait(100).then(()=> readFileBusy(path))
    })
}

export function wantArray(x:any) {
    return x == null ? [] : Array.isArray(x) ? x : [x]
}

export function watchLoad(path:string, parser:(data:any)=>void|Promise<void>) {
    let doing = false
    const timer = setInterval(()=>{
        try {
            watch(path, load)
            load().then()
            clearInterval(timer)
        }
        catch(e){
        }
    }, 1000)

    async function load(){
        if (doing) return
        doing = true
        console.debug('loading', path)
        let data: any
        try {
            data = yaml.parse(await readFileBusy(path))
        } catch (e) {
            doing = false
            console.warn('cannot read', path, String(e))
            return
        }
        await parser(data)
        doing = false
    }
}

// callback can return undefined to skip element
export async function* filterMapGenerator<IN,OUT>(generator: AsyncIterableIterator<IN>, filterMap: (el: IN) => Promise<OUT>) {
    for await (const x of generator) {
        const res:OUT = await filterMap(x)
        if (res !== undefined)
            yield res as Exclude<OUT,undefined>
    }
}

import { EventEmitter } from 'events'
import fs from 'fs/promises'
import { basename, dirname } from 'path'
import { watch } from 'fs'
import _ from 'lodash'

export type Callback<IN=void, OUT=void> = (x:IN) => OUT

export function enforceFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s : s+sub
}

export async function isDirectory(path: string) {
    try { return (await fs.stat(path)).isDirectory() }
    catch { return false }
}

export async function isFile(path: string) {
    try { return (await fs.stat(path)).isFile() }
    catch { return false }
}

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

export function setHidden(dest: object, src:object) {
    Object.defineProperties(dest, objSameKeys(src as any, value => ({ enumerable:false, value })))
}

export function objSameKeys<T,R>(src: Record<string,T>, newValue:(value:T,key:string)=>R) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k)]))
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

export function wantArray<T>(x?: void | T | T[]) {
    return x == null ? [] : Array.isArray(x) ? x : [x]
}

// callback can return undefined to skip element
export async function* filterMapGenerator<IN,OUT>(generator: AsyncIterableIterator<IN>, filterMap: (el: IN) => Promise<OUT>) {
    for await (const x of generator) {
        const res:OUT = await filterMap(x)
        if (res !== undefined)
            yield res as Exclude<OUT,undefined>
    }
}

export async function asyncGeneratorToArray<T>(generator: AsyncIterable<T>): Promise<T[]> {
    const ret: T[] = []
    for await(const x of generator)
        ret.push(x)
    return ret
}

// let you use work with a callback when a generator is required
export function generatorAsCallback<T>(caller: Callback<{ callback:Callback<T> }>) {
    let p = pendingPromise()
    const ref = { callback: p.resolve }
    caller(ref)
    return {
        [Symbol.asyncIterator]: () =>
            ({
                async next() {
                    const value = await p
                    p = pendingPromise()
                    ref.callback = p.resolve
                    return { value }
                }
            })
    }
}

export function getOrSet<T>(o:any, k:string, creator:()=>T): T {
    return k in o ? o[k]
        : (o[k] = creator())
}

export function randomId(len = 10) {
    // 10 chars is 51+bits, the max we can give. 8 is 41+bits
    if (len > 10) throw Error('bad length');
    return Math.random()
        .toString(36)
        .substring(2, 2+len)
        .replace(/l/g, 'L'); // avoid confusion reading l1
}

export function onProcessExit(cb: (signal:string)=>void) {
    onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT'], cb)
}

export function onFirstEvent(emitter:EventEmitter, events: string[], cb: (...args:any[])=> void) {
    let already = false
    for (const e of events)
        emitter.on(e, (...args) => {
            if (already) return
            already = true
            cb(...args)
        })
}

export function watchDir(dir: string, cb: ()=>void) {
    const base = basename(dir)
    watch(dirname(dir), (event,name) => {
        if (name === base)
            cb()
    })
    cb()
    try { watch(dir, cb) }
    catch {}
}

export function pattern2filter(pattern: string){
    const re = new RegExp(_.escapeRegExp(pattern), 'i')
    return (s?:string) =>
        !s || !pattern || re.test(basename(s))
}

export function isWindows() {
    return process.platform === 'win32'
}

type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

export function truthy<T>(value: T): value is Truthy<T> {
    return Boolean(value)
}

export function onlyTruthy<T>(arr: T[]) {
    return arr.filter(truthy)
}

type PendingPromise<T> = Promise<T> & { resolve: (value: T) => void, reject: (reason?: any) => void }
export function pendingPromise<T>() {
    let takeOut
    const ret = new Promise<T>((resolve, reject) =>
        takeOut = { resolve, reject })
    return Object.assign(ret, takeOut) as PendingPromise<T>
}

// install multiple handlers and returns a handy 'uninstall' function which requires no parameter. Pass a map {event:handler}
export function onOffMap(em: EventEmitter, events: { [eventName:string]: (...args: any[]) => void }) {
    events = { ...events } // avoid later modifications, as we need this later for uninstallation
    for (const k in events)
        em.on(k, events[k])
    return () => {
        for (const k in events)
            em.off(k, events[k])
    }
}

// avoid for an async function to be overlapped with another execution while awaiting
export function debounceAsync(cb: any, ms: number=100, ...args:any[]) {
    const debounced = _.debounce(cb, ms, ...args)
    let running: false | number = false
    return async () => {
        if (running && Date.now() - running < ms) return
        while (running)
            await wait(ms)
        running = Date.now()
        try { return await debounced() }
        finally { running = false }
    }
}

export function dirTraversal(s?: string) {
    return s && /(^|[/\\])\.\.($|[/\\])/.test(s)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { EventEmitter } from 'events'
import fs from 'fs/promises'
import { basename, dirname } from 'path'
import { watch } from 'fs'
import _ from 'lodash'
import { Readable } from 'stream'
import Koa from 'koa'
import glob from 'fast-glob'
import { IS_WINDOWS } from './const'
import { execFile } from 'child_process'
import { Connection } from './connections'
import assert from 'assert'

export type Callback<IN=void, OUT=void> = (x:IN) => OUT
export type Dict<T = any> = Record<string, T>

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
    return Object.defineProperties(dest, objSameKeys(src as any, value => ({
        enumerable: false,
        writable: true,
        value,
    })))
}

export function objSameKeys<S extends object,VR=any>(src: S, newValue:(value:Truthy<S[keyof S]>, key:keyof S)=>any) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k as keyof S)])) as { [K in keyof S]:VR }
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

export function asyncGeneratorToReadable<T>(generator: AsyncIterable<T>) {
    const iterator = generator[Symbol.asyncIterator]()
    return new Readable({
        objectMode: true,
        read() {
            iterator.next().then(it =>
                this.push(it.done ? null : it.value))
        }
    })
}

export function getOrSet<T>(o: Record<string,T>, k:string, creator:()=>T): T {
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
    onFirstEvent(process, ['exit', 'SIGQUIT', 'SIGTERM', 'SIGINT', 'SIGHUP'], cb)
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
    try { watch(dir, cb) }
    catch {
        // failing watching the content of the dir, we try to monitor its parent, but filtering events only for our target dir
        const base = basename(dir)
        try {
            const watcher = watch(dirname(dir), (event,name) => {
                if (name !== base) return
                try {
                    watch(dir, cb) // attempt at passing to a more specific watching
                    watcher.close() // if we succeed, we give up the parent watching
                }
                catch {}
                cb()
            })
        }
        catch (e) {
            console.debug(String(e))
            return false
        }
    }
}

export function pattern2filter(pattern: string){
    const re = new RegExp(_.escapeRegExp(pattern), 'i')
    return (s?:string) =>
        !s || !pattern || re.test(basename(s))
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
export function onOff(em: EventEmitter, events: { [eventName:string]: (...args: any[]) => void }) {
    events = { ...events } // avoid later modifications, as we need this later for uninstallation
    for (const [k,cb] of Object.entries(events))
        for (const e of k.split(' '))
            em.on(e, cb)
    return () => {
        for (const [k,cb] of Object.entries(events))
            for (const e of k.split(' '))
                em.off(e, cb)
    }
}

// like lodash.debounce, but also avoids async invocations to overlap
export function debounceAsync<CB extends (...args: any[]) => Promise<R>, R>(
    callback: CB,
    wait: number=100,
    { leading=false, maxWait=Infinity }={}
) {
    let started = 0 // latest callback invocation
    let runningCallback: Promise<R> | undefined // latest callback invocation result
    let runningDebouncer: Promise<R | undefined> // latest wrapper invocation
    let waitingSince = 0 // we are delaying invocation since
    let whoIsWaiting: undefined | any[] // args' array object identifies the pending instance, and incidentally stores args
    const interceptingWrapper = (...args:any[]) => runningDebouncer = debouncer.apply(null, args)
    return Object.assign(interceptingWrapper, {
        cancel: () => whoIsWaiting = undefined,
        flush() {
            return whoIsWaiting ? callback.apply(null, whoIsWaiting) : this.cancel()
        },
    })

    async function debouncer(...args:any[]) {
        whoIsWaiting = args
        waitingSince ||= Date.now()
        await runningCallback
        const waitingCap = maxWait - (Date.now() - (waitingSince || started))
        const waitFor = Math.min(waitingCap, leading ? wait - (Date.now() - started) : wait)
        if (waitFor > 0)
            await new Promise(resolve => setTimeout(resolve, waitFor))
        if (!whoIsWaiting) // canceled
            return void(waitingSince = 0)
        if (whoIsWaiting !== args) // another fresher call is waiting
            return runningDebouncer
        waitingSince = 0
        whoIsWaiting = undefined
        started = Date.now()
        try {
            runningCallback = callback.apply(null, args)
            return await runningCallback
        }
        finally { runningCallback = undefined }
    }
}

export function dirTraversal(s?: string) {
    return s && /(^|[/\\])\.\.($|[/\\])/.test(s)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export function objRenameKey(o: Dict | undefined, from: string, to: string) {
    if (!o || !o.hasOwnProperty(from) || from === to) return
    o[to] = o[from]
    delete o[from]
    return true
}

export function typedKeys<T>(o: T) {
    return Object.keys(o) as (keyof T)[]
}

export function with_<T,RT>(par:T, cb: (par:T) => RT) {
    return cb(par)
}

export function isLocalHost(c: Connection | Koa.Context) {
    const ip = c.socket.remoteAddress // don't use Context.ip as it is subject to proxied ips, and that's no use for localhost detection
    return ip && (ip === '::1' || ip.endsWith('127.0.0.1'))
}

export async function* dirStream(path: string) {
    const dirStream = glob.stream('*', {
        cwd: path,
        dot: true,
        onlyFiles: false,
        suppressErrors: true,
    })
    const skip = await getItemsToSkip(path)
    for await (let path of dirStream) {
        if (path instanceof Buffer)
            path = path.toString('utf8')
        if (skip?.includes(path))
            continue
        yield path
    }

    async function getItemsToSkip(path: string) {
        if (!IS_WINDOWS) return
        const out = await run('dir', ['/ah', '/b', path.replace(/\//g, '\\')])
            .catch(()=>'') // error in case of no matching file
        return out.split('\r\n').slice(0,-1)
    }
}

export function run(cmd: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) =>
        execFile('cmd', ['/c', cmd, ...args], (err, stdout) => {
            if (err)
                reject(err)
            else
                resolve(stdout)
        }))
}

export function same(a: any, b: any) {
    try {
        assert.deepStrictEqual(a, b)
        return true
    }
    catch { return false }
}

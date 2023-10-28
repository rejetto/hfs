// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt
// all content here is shared between client and server
import _ from 'lodash'
import { VfsNodeStored } from './vfs'
export * from './cross-const'

export const REPO_URL = 'https://github.com/rejetto/hfs/'
export const WIKI_URL = REPO_URL + 'wiki/'
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
export const MAX_TILE_SIZE = 10
export const FRONTEND_OPTIONS = {
    file_menu_on_link: true,
    tile_size: 0,
    sort_by: 'name',
    invert_order: false,
    folders_first: true,
    sort_numerics: false,
    theme: '',
}
export const SORT_BY_OPTIONS = ['name', 'extension', 'size', 'time']
export const THEME_OPTIONS = { auto: '', light: 'light', dark: 'dark' }

export type Dict<T=any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0
type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T
export type Callback<IN=void, OUT=void> = (x:IN) => OUT
export type Promisable<T> = T | Promise<T>

interface Mapping {
    public: { host: string; port: number }
    private: { host: string; port: number }
    protocol: string
    enabled: boolean
    description: string
    ttl: number
    local: boolean
}

export interface VfsPerms {
    can_see?: Who
    can_read?: Who
    can_list?: Who
    can_upload?: Who
    can_delete?: Who
    can_archive?: Who
}
export const WHO_ANYONE = true
export const WHO_NO_ONE = false
export const WHO_ANY_ACCOUNT = '*'
type AccountList = string[]
export type Who = typeof WHO_ANYONE
    | typeof WHO_NO_ONE
    | typeof WHO_ANY_ACCOUNT
    | keyof VfsPerms
    | WhoObject
    | AccountList // use false instead of empty array to keep the type boolean-able
export interface WhoObject { this?: Who, children?: Who }

export const defaultPerms: Required<VfsPerms> = {
    can_see: 'can_read',
    can_read: WHO_ANYONE,
    can_list: 'can_read',
    can_upload: WHO_NO_ONE,
    can_delete: WHO_NO_ONE,
    can_archive: 'can_read'
}

export type VfsNodeAdminSend = {
    name: string
    type?: 'folder'
    size?: number
    ctime?: Date
    mtime?: Date
    website?: true
    byMasks?: VfsPerms
    inherited?: VfsPerms
    children?: VfsNodeAdminSend[]
} & Omit<VfsNodeStored, 'children'>

export const PERM_KEYS = typedKeys(defaultPerms)

export function isWhoObject(v: undefined | Who): v is WhoObject {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const MULTIPLIERS = ['', 'K', 'M', 'G', 'T']
export function formatBytes(n: number, { post='B', k=1024, digits=NaN }={}) {
    if (isNaN(Number(n)) || n < 0)
        return ''
    const i = n && Math.floor(Math.log2(n) / Math.log2(k))
    n /= k ** i
    const nAsString = i && !isNaN(digits) ? n.toFixed(digits)
        : _.round(n, isNaN(digits) ? (n >= 100 ? 0 : 1) : digits)
    return nAsString + ' ' + (MULTIPLIERS[i]||'') + post
} // formatBytes

export function prefix(pre:string, v:string|number|undefined|null|false, post:string='') {
    return v ? pre+v+post : ''
}

export function wait<T=undefined>(ms: number, val?: T): Promise<T | undefined> {
    return new Promise(res=> setTimeout(res,ms,val))
}

export function haveTimeout<T>(ms: number, job: Promise<T>, error?: any) {
    return Promise.race([job, wait(ms).then(() => { throw error || Error('timeout') })])
}

export function objSameKeys<S extends object,VR=any>(src: S, newValue:(value:Truthy<S[keyof S]>, key:keyof S)=>VR) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k as keyof S)])) as { [K in keyof S]:VR }
}

export function enforceFinal(sub:string, s:string, evenEmpty=false) {
    return !evenEmpty && !s || s.endsWith(sub) ? s : s+sub
}

export function truthy<T>(value: T): value is Truthy<T> {
    return Boolean(value)
}

export function onlyTruthy<T>(arr: T[]) {
    return arr.filter(truthy)
}

export function setHidden<T, ADD>(dest: T, src: ADD) {
    return Object.defineProperties(dest, newObj(src as any, value => ({
        enumerable: false,
        writable: true,
        value,
    }))) as T & ADD
}

export function try_(cb: () => any, onException?: (e:any) => any) {
    try {
        return cb()
    }
    catch(e) {
        return onException?.(e)
    }
}

export function with_<T,RT>(par:T, cb: (par:T) => RT) {
    return cb(par)
}

export function formatPerc(p: number) {
    return (p*100).toFixed(1) + '%'
}

export function wantArray<T>(x?: void | T | T[]) {
    return x == null ? [] : Array.isArray(x) ? x : [x]
}

export function _log(...args: any[]) {
    console.log('**', ...args)
    return args[args.length-1]
}

export function _dbg(x: any) {
    debugger
    return x
}

export type PendingPromise<T=unknown> = Promise<T> & { resolve: (value?: T) => void, reject: (reason?: any) => void }
export function pendingPromise<T>() {
    let takeOut
    const ret = new Promise<T>((resolve, reject) =>
        takeOut = { resolve, reject })
    return Object.assign(ret, takeOut) as PendingPromise<T>
}

export function basename(path: string) {
    return path.slice(path.lastIndexOf('/') + 1 || path.lastIndexOf('\\') + 1)
}

export function tryJson(s?: string, except?: (s?: string) => unknown) {
    try { return s && JSON.parse(s) }
    catch { return except?.(s) }
}

export function swap<T>(obj: T, k1: keyof T, k2: keyof T) {
    const temp = obj[k1]
    obj[k1] = obj[k2]
    obj[k2] = temp
    return obj
}

export function isOrderedEqual(a: any, b: any): boolean {
    return _.isEqualWith(a, b, (a1, b1) => {
        if (!_.isPlainObject(a1) || !_.isPlainObject(b1)) return
        const ka = Object.keys(a1)
        const kb = Object.keys(b1)
        return ka.length === kb.length && ka.every((ka1, i) => {
            const kb1 = kb[i]
            return ka1 === kb1 && isOrderedEqual(a1[ka1], b1[kb1])
        })
    })
}

export function findDefined<I, O>(a: I[] | Record<string, I>, cb:(v:I, k: string | number)=>O): any {
    if (a) for (const k in a) {
        const ret = cb((a as any)[k] as I, k)
        if (ret !== undefined)
            return ret
    }
}

export function removeStarting(sub: string, s: string) {
    return s.startsWith(sub) ? s.slice(sub.length) : s
}

export function newObj<S extends (object | undefined | null),VR=any>(
    src: S,
    returnNewValue: (value:Truthy<S[keyof S]>, key: Exclude<keyof S, symbol>, setK:(newK?: string)=>true, depth: number) => any,
    recur: boolean | number=false
) {
    if (!src)
        return {}
    const pairs = Object.entries(src).map( ([k,v]) => {
        if (typeof k === 'symbol') return
        let _k: undefined | typeof k = k
        const curDepth = typeof recur === 'number' ? recur : 0
        let newV = returnNewValue(v, k as Exclude<keyof S, symbol>, (newK) => {
            _k = newK
            return true // for convenient expression concatenation
        }, curDepth)
        if ((recur !== false || returnNewValue.length === 4) // if callback is using depth parameter, then it wants recursion
            && _.isPlainObject(newV)) // is it recurrable?
            newV = newObj(newV, returnNewValue, curDepth + 1)
        return _k !== undefined && [_k, newV]
    })
    return Object.fromEntries(onlyTruthy(pairs)) as S extends undefined | null ? S : { [K in keyof S]:VR }
}

// returns undefined if timeout is reached
export async function waitFor<T>(cb: ()=> Promisable<T>, { interval=200, timeout=Infinity }={}) {
    const started = Date.now()
    while (1) {
        const res = await cb()
        if (res)
            return res
        if (Date.now() - started >= timeout)
            return
        await wait(interval)
    }
}

export function getOrSet<T>(o: Record<string,T>, k:string, creator:()=>T): T {
    return k in o ? o[k]!
        : (o[k] = creator())
}

// 10 chars is 51+bits, 8 is 41+bits
export function randomId(len = 10): string {
    if (len > 10)
        return randomId(10) + randomId(len - 10)
    return Math.random()
        .toString(36)
        .substring(2, 2+len)
        .replace(/l/g, 'L'); // avoid confusion reading l1
}

export function objRenameKey(o: Dict | undefined, from: string, to: string) {
    if (!o || !o.hasOwnProperty(from) || from === to) return
    o[to] = o[from]
    delete o[from]
    return true
}

export function typedKeys<T extends {}>(o: T) {
    return Object.keys(o) as (keyof T)[]
}

export function typedEntries<T extends {}>(o: T): [keyof T, T[keyof T]][] {
    return Object.entries(o) as [keyof T, T[keyof T]][];
}

export function hasProp<T extends object>(obj: T, key: PropertyKey): key is keyof T {
    return key in obj;
}

export function throw_(err: any): never {
    throw err
}

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

export function repeat(every: number, cb: () => unknown): Promise<ReturnType<typeof setTimeout>>{
    return Promise.allSettled([cb()]).then(() =>
        setTimeout(() => repeat(every, cb), every) )
}

export function formatTimestamp(x: string) {
    return x ? new Date(x).toLocaleString() : '-'
}

export function isPrimitive(x: unknown): x is boolean | string | number | undefined | null {
    return !x || Object(x) !== x
}

export function isIP(address: string) {
    return /^([.:\da-f]+)$/i.test(address)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export function isEqualLax(a: any,b: any): boolean {
    return a == b //eslint-disable-line
        || (a && b && typeof a === 'object' && typeof b === 'object'
            && Object.entries(a).every(([k, v]) => isEqualLax(v, b[k]))
            && Object.entries(b).every(([k, v]) => Object.hasOwn(a, k) || isEqualLax(v, a[k])) )
}

export function xlate(input: any, table: Record<string, any>) {
    return table[input] ?? input
}

export function ipLocalHost(ip: string) {
    return ip === '::1' || ip.endsWith('127.0.0.1')
}

export function ipForUrl(ip: string) {
    return ip.includes(':') ? '[' + ip + ']' : ip
}

export function escapeHTML(text: string) {
    return text.replace(/[\u0000-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u00FF]/g,
        c => '&#' + ('000' + c.charCodeAt(0)).slice(-4) + ';')
}

// wait for all, but returns only those that resolved
export async function promiseBestEffort<T>(promises: Promise<T>[]) {
    const res = await Promise.allSettled(promises)
    return res.filter(x => x.status === 'fulfilled').map((x: any) => x.value as T)
}

export function runAt(ts: number, cb: Callback) {
    let cancel = false
    let t: any
    setTimeout(async () => {
        if (missing() < 0) return
        const max = 0x7FFFFFFF
        while (!cancel && missing() > max)
            await wait(max)
        if (cancel) return
        t = setTimeout(cb, missing())

        function missing() {
            return ts - Date.now()
        }
    })
    return () => {
        cancel = true
        clearTimeout(t)
    }
}
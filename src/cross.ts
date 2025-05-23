// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt
// all content here is shared between client and server
import _ from 'lodash'
import { VfsNodeStored } from './vfs'
import picomatch from 'picomatch/lib/picomatch'
import { HFS_REPO } from './cross-const' // point directly to the browser-compatible source
export * from './cross-const'

export const WEBSITE = 'https://rejetto.com/hfs/'
export const REPO_URL = `https://github.com/${HFS_REPO}/`
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
    title_with_path: true,
    theme: '',
    auto_play_seconds: 5,
    disableTranslation: false,
}
export const SORT_BY_OPTIONS = ['name', 'extension', 'size', 'time', 'creation']
export const THEME_OPTIONS = { auto: '', light: 'light', dark: 'dark' }
// had found an interesting way to infer a type from all the calls to defineConfig (by the literals passed), but would not be usable also by admin-panel
export const CFG = constMap(['geo_enable', 'geo_allow', 'geo_list', 'geo_allow_unknown', 'dynamic_dns_url',
    'log', 'error_log', 'log_rotation', 'dont_log_net', 'log_gui', 'log_api', 'log_ua', 'log_spam', 'track_ips',
    'max_downloads', 'max_downloads_per_ip', 'max_downloads_per_account', 'roots', 'force_address', 'split_uploads',
    'force_lang', 'suspend_plugins', 'base_url', 'size_1024', 'disable_custom_html', 'comments_storage'])
export const LIST = { add: '+', remove: '-', update: '=', props: 'props', ready: 'ready', error: 'e' }
export type Dict<T=any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0
type Truthy<T> = T extends false | '' | 0 | null | undefined | void ? never : T
export type Callback<IN=void, OUT=void> = (x:IN) => OUT
export type Promisable<T> = T | Promise<T>
export type Functionable<T, Args extends any[] = any[]> = T | ((...args: Args) => T)
export type Timeout = ReturnType<typeof setTimeout>
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
export type Jsonify<T> = T extends string | number | boolean | null | undefined ? T : // undefined is necessary to preserve union types, like number|undefined
    T extends Date ? string :
    T extends (infer U)[] ? Jsonify<U>[] :
    T extends object ? { [K in keyof T]: Jsonify<T[K]> } :
    never

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
    birthtime?: Date
    mtime?: Date
    website?: true
    byMasks?: VfsPerms
    inherited?: VfsPerms
    children?: VfsNodeAdminSend[]
} & Omit<VfsNodeStored, 'children'>

export const PERM_KEYS = typedKeys(defaultPerms)

function constMap<T extends string>(a: T[]): { [K in T]: K } {
    return Object.fromEntries(a.map(x => [x, x])) as { [K in T]: K };
}

export function isWhoObject(v: undefined | Who): v is WhoObject {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const MULTIPLIERS = ['', 'K', 'M', 'G', 'T']
export declare namespace formatBytes { let k: number }
export function formatBytes(n: number, { post='B', k=0, digits=NaN, sep=' ' }={}) {
    if (isNaN(Number(n)) || n < 0)
        return ''
    k ||= formatBytes.k ?? 1024 // default value
    const i = n && Math.min(MULTIPLIERS.length - 1, Math.floor(Math.log2(n) / Math.log2(k)))
    n /= k ** i
    const nAsString = i && !isNaN(digits) ? n.toFixed(digits)
        : _.round(n, isNaN(digits) ? (n >= 100 ? 0 : 1) : digits)
    return nAsString + sep + (MULTIPLIERS[i]||'') + post
} // formatBytes

export function formatSpeed(n: number, options: Parameters<typeof formatBytes>[1]={}) {
    return formatBytes(n, { post: 'B/s', ...options })
}

export function prefix(pre: Falsy | string, v: string | number | undefined | null | false, post: Falsy | string='') {
    return v ? (pre||'') + v + (post || '') : ''
}

export function join(a: string, b: string, joiner='/') { // similar to path.join but OS independent
    if (!b) return a
    if (!a) return b
    const ends = a.at(-1) === joiner
    const starts = b[0] === joiner
    return a + (!ends && !starts ? joiner + b : ends && starts ? b.slice(1) : b)
}

export function wait<T=undefined>(ms: number, val?: T): Promise<T | undefined> {
    return new Promise(res=> setTimeout(res,ms,val))
}

// throws after ms
export function haveTimeout<T>(ms: number, job: Promise<T>, error?: any) {
    return Promise.race([job, wait(ms).then(() => { throw error || Error('timeout') })])
}

export function objSameKeys<S extends object,VR=any>(src: S, newValue:(value:Truthy<S[keyof S]>, key:keyof S)=>VR) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k as keyof S)])) as { [K in keyof S]:VR }
}

export function objFromKeys<K extends string, VR=unknown>(src: K[], getValue: (value: K)=> VR) {
    return Object.fromEntries(src.map(k => [k, getValue(k)]))
}

export function enforceFinal(sub:string, s:string, evenEmpty=false) {
    return (s ? !s.endsWith(sub) : evenEmpty) ? s + sub : s
}

export function removeFinal(sub:string, s:string) {
    return s.endsWith(sub) ? s.slice(0, -sub.length) : s
}

export function enforceStarting(sub:string, s:string, evenEmpty=false) {
    return (s ? !s.startsWith(sub) : evenEmpty) ? sub + s : s
}

export function removeStarting(sub: string, s: string) {
    return s.startsWith(sub) ? s.slice(sub.length) : s
}

export function strinsert(s: string, at: number, insert: string, remove=0) {
    return s.slice(0, at) +  insert + s.slice(at + remove)
}

export function splitAt(sub: string | number, all: string): [string, string] {
    if (typeof sub === 'number')
        return [all.slice(0, sub), all.slice(sub + 1)]
    const i = all.indexOf(sub)
    return i < 0 ? [all,''] : [all.slice(0, i), all.slice(i + sub.length)]
}

export function stringAfter(sub: string, all: string) {
    const i = all.indexOf(sub)
    return i < 0 ? '' : all.slice(i + sub.length)
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

export function try_<T,E=undefined>(cb: () => T, onException?: (e:any) => E) {
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
    return path.match(/([^\\/]+)[\\/]*$/)?.[1] || ''
}

export function dirname(path: string) {
    return path.slice(0, Math.max(0, path.lastIndexOf('/', path.length - 1)))
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

// create new object with values returned by callback. Keys are kept the same unless you call `setK('myKey')`. Calling `setK` without parameters, which implies `undefined`, will remove the key.
export function newObj<S extends (object | undefined | null),VR=unknown>(
    src: S,
    returnNewValue: (value: S[keyof S], key: Exclude<keyof S, symbol>, setK:(newK?: string)=>true, depth: number) => any,
    recur: boolean | number=false // recur on the returned value, if it's an object
) {
    let _k: undefined | string
    const entries = Object.entries(src || {}).map( ([k,v]) => {
        const curDepth = typeof recur === 'number' ? recur : 0
        _k = k
        let newV = returnNewValue(v, k as Exclude<keyof S, symbol>, setK, curDepth)
        if ((recur !== false || returnNewValue.length === 4) // if callback is using depth parameter, then it wants recursion
            && _.isPlainObject(newV)) // is it recurrable?
            newV = newObj(newV, returnNewValue, curDepth + 1)
        return _k !== undefined && [_k, newV]
    })
    return Object.fromEntries(onlyTruthy(entries)) as S extends undefined | null ? S : { [K in keyof S]:VR }

    function setK(newK: typeof _k) { // declare once (optimization)
        _k = newK
        return true as const // for convenient expression concatenation: setK('newK') && 'newValue'
    }
}

// returns undefined if timeout is reached, otherwise the value returned by the callback
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

// like setInterval but: async executions don't overlap AND the first execution is immediate
export function repeat(everyMs: number, cb: Callback<Callback>): Callback {
    let stop = false
    ;(async () => {
        while (!stop) {
            try { await cb(stopIt) } // you can use stopIt passed as a parameter or the returned value, whatever makes you happy
            catch {}
            await wait(everyMs)
        }
    })()
    return stopIt
    function stopIt() {
        stop = true
    }
}

export function formatTimestamp(x: number | string | Date, includeSeconds=true) {
    if (!x) return ''
    if (!(x instanceof Date))
        x = new Date(x)
    return formatDate(x) + ' ' + formatTime(x, includeSeconds)
}

export function formatTime(d: Date, includeSeconds=true) {
// bundled nodejs doesn't have locales
    return String(d.getHours()).padStart(2, '0')
        + ':' + String(d.getMinutes()).padStart(2, '0')
        + (includeSeconds ? ':' + String(d.getSeconds()).padStart(2, '0') : '')
}

export function formatDate(d: Date) {
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(x => x.toString().padStart(2, '0')).join('-')
}

export function isNumeric(x: unknown) {
    return _.isNumber(x) || _.isString(x) && !isNaN(Number(x))
}

export function isPrimitive(x: unknown): x is boolean | string | number | undefined | null {
    return x === null || typeof x !== 'object' && typeof x !== 'function' // from node's documentation
}

export function isIP(address: string) {
    return /^([.:\da-f]+)$/i.test(address)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export function isTimestampString(v: unknown) {
    return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z*$/.test(v)
}

export function isEqualLax(a: any,b: any, overrideRule?: (a: any, b: any) => boolean | undefined): boolean {
    return overrideRule?.(a, b) ?? (
        a == b || a && b && typeof a === 'object' && typeof b === 'object'
            && Object.entries(a).every(([k, v]) => isEqualLax(v, b[k], overrideRule))
            && Object.entries(b).every(([k, v]) => k in a /*already checked*/ || isEqualLax(v, a[k], overrideRule))
    )
}

export function xlate(input: any, table: Record<string, any>) {
    return table[input] ?? input
}

export function normalizeHost(host: string) {
    return host[0] === '[' ? host.slice(1, host.indexOf(']')) : host?.split(':')[0]
}

export function isIpLocalHost(ip: string) {
    return ip === '::1' || ip.endsWith('127.0.0.1')
}

export function isIpLan(ip: string) {
    return /^(?:10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|fe80::)/.test(ip)
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

// encode paths leaving / separator unencoded (not like encodeURIComponent), but still encode #
export function pathEncode(s: string) {
    return s.replace(/[:&#'"% ?\\]/g, escape) // escape() is not utf8, but we are encoding only ascii chars
}
//unused function pathDecode(s: string) { return decodeURI(s).replace(/%23/g, '#') }

// run at a specific point in time, also solving the limit of setTimeout, which doesn't work with +32bit delays
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

export function makeMatcher(mask: string, emptyMaskReturns=false) {
    return mask ? picomatch(mask.replace(/^(!)?/, '$1(') + ')', { nocase: true}) // adding () will allow us to use the pipe at root level
        : () => emptyMaskReturns
}

// this is caching all matchers, so don't use it with frequently changing masks. Benchmarks revealed that _.memoize make it slower than not using it, while this simple cache can speed up to 30x
export function matches(s: string, mask: string, emptyMaskReturns=false) {
    const cache = (matches as any).cache ||= {}
    return (cache[mask + (emptyMaskReturns ? '1' : '0')] ||= makeMatcher(mask, emptyMaskReturns))(s)
}

// if delimiter is specified, it is prefixed to symbols. If it contains a space, the part after the space is considered as suffix.
export function replace(s: string, symbols: Dict<string | Callback<string, string>>, delimiter='') {
    const [open, close] = splitAt(' ', delimiter)
    for (const [k, v] of Object.entries(symbols))
        s = s.replaceAll(open + k + close, v as any) // typescript doesn't handle overloaded functions (like replaceAll) with union types https://stackoverflow.com/a/66510061/646132
    return s
}

export function inCommon<T extends string | unknown[]>(a: T, b: T) {
    let i = 0
    const n = a.length
    while (i < n && a[i] === b[i]) i++
    return i
}

export function mapFilter<T=unknown, R=T>(arr: T[], map: (x:T, idx: number) => R, filter=(x: R) => x === undefined, invert=false) {
    return arr[invert ? 'reduceRight' : 'reduce']((ret, x, idx) => {
        const y = map(x, idx)
        if (filter(y))
            ret.push(y) // push is much faster than unshift, therefore invert using reduceRight https://measurethat.net/Benchmarks/Show/29/0/array-push-vs-unshift
        return ret
    }, [] as R[])
}

export function callable<T>(x: Functionable<T>, ...args: unknown[]) {
    return _.isFunction(x) ? x(...args) : x
}

export function safeDecodeURIComponent(s: string) {
    try { return decodeURIComponent(s) }
    catch { return s }
}

export function popKey(o: any, k: string) {
    if (!o) return
    const x = o[k]
    delete o[k]
    return x
}

export function patchKey(o: any, k: string, replacer: (was: unknown) => unknown) {
    o[k] = replacer(o[k])
    return o
}

export function shortenAgent(agent: string) {
    return _.findKey(BROWSERS, re => re.test(agent))
        || /^[^/(]+ ?/.exec(agent)?.[0]
        || agent
}
const BROWSERS = {
    YaBrowser: /yabrowser/i,
    AlamoFire: /alamofire/i,
    Edge: /edge|edga|edgios|edg/i,
    PhantomJS: /phantomjs/i,
    Konqueror: /konqueror/i,
    Amaya: /amaya/i,
    Epiphany: /epiphany/i,
    SeaMonkey: /seamonkey/i,
    Flock: /flock/i,
    OmniWeb: /omniweb/i,
    Opera: /opera|OPR\//i,
    Chromium: /chromium/i,
    Facebook: /FBA[NV]/,
    Chrome: /chrome|crios/i,
    WinJs: /msapphost/i,
    IE: /msie|trident/i,
    Firefox: /firefox|fxios/i,
    Safari: /safari/i,
    PS5: /playstation 5/i,
    PS4: /playstation 4/i,
    PS3: /playstation 3/i,
    PSP: /playstation portable/i,
    PS: /playstation/i,
    Xbox: /xbox/i,
    UC: /UCBrowser/i,
}
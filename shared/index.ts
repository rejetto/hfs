// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
export * from './react'
export * from './dialogs'
export * from './srp'

export type Dict<T=any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0
type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

(window as any)._ = _

export const urlParams = Object.fromEntries(new URLSearchParams(window.location.search).entries())

const MULTIPLIERS = ['', 'K', 'M', 'G', 'T']
export function formatBytes(n: number, { post='B', k=1024, digits=NaN }={}) {
    if (isNaN(Number(n)) || n < 0)
        return ''
    let prevMul = 1
    let mul = k
    let i = 0
    while (i < MULTIPLIERS.length && n > mul) {
        prevMul = mul
        mul *= k
        ++i
    }
    n /= prevMul
    const nAsString = i && !isNaN(digits) ? n.toFixed(digits)
        : _.round(n, isNaN(digits) ? (n >= 100 ? 0 : 1) : digits)
    return nAsString + ' ' + (MULTIPLIERS[i]||'') + post
} // formatBytes

export function prefix(pre:string, v:string|number|undefined|null|false, post:string='') {
    return v ? pre+v+post : ''
}

export function wait<T=undefined>(ms: number, val?: T): Promise<T> {
    return new Promise(res=> setTimeout(res,ms,val))
}

export function getCookie(name: string) {
    const pre = name + '='
    //@ts-ignore necessary to import this file in tests.ts (node doesn't have document)
    let decodedCookie = decodeURIComponent(document.cookie)
    let ca = decodedCookie.split(';')
    for (let c of ca) {
        c = c.trim()
        if (c.startsWith(pre))
            return c.substring(pre.length, c.length)
    }
    return ''
}

export function objSameKeys<S extends object,VR=any>(src: S, newValue:(value:Truthy<S[keyof S]>, key:keyof S)=>any) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k as keyof S)])) as { [K in keyof S]:VR }
}

export function enforceFinal(sub:string, s:string) {
    return !s || s.endsWith(sub) ? s : s+sub
}

export function truthy<T>(value: T): value is Truthy<T> {
    return Boolean(value)
}

export function onlyTruthy<T>(arr: T[]) {
    return arr.filter(truthy)
}

export function setHidden(dest: object, src:object) {
    return Object.defineProperties(dest, objSameKeys(src as any, value => ({
        enumerable: false,
        writable: true,
        value,
    })))
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

export function domOn<K extends keyof WindowEventMap>(eventName: K, cb: (ev: WindowEventMap[K]) => void, { target=window }={}) {
    target.addEventListener(eventName, cb)
    return () => target.removeEventListener(eventName, cb)
}


export function findFirst<I, O>(a: I[] | Record<string, I>, cb:(v:I, k: string | number)=>O): any {
    if (a) for (const k in a) {
        const ret = cb((a as any)[k] as I, k)
        if (ret !== undefined)
            return ret
    }
}

export function selectFiles(cb: (list: FileList | null)=>void, { accept='', multiple=true, folder=false }={}) {
    const el = Object.assign(document.createElement('input'), {
        type: 'file',
        name: 'file',
        accept,
        multiple: multiple,
        webkitdirectory: folder,
    })
    el.addEventListener('change', () =>
        cb(el.files))
    el.click()
}

export function readFile(f: File | Blob): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', (event) => {
            if (!event.target || f.size && !event.target.result)
                return reject('cannot read')
            const {result} = event.target
            resolve(result?.toString())
        })
        reader.addEventListener('error', () => {
            reject(reader.error)
        })
        reader.readAsText(f)
    })
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

type PendingPromise<T> = Promise<T> & { resolve: (value: T) => void, reject: (reason?: any) => void }
export function pendingPromise<T>() {
    let takeOut
    const ret = new Promise<T>((resolve, reject) =>
        takeOut = { resolve, reject })
    return Object.assign(ret, takeOut) as PendingPromise<T>
}

export function isMobile() {
    return window.innerWidth < 800
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
export * from './react'

export type Dict<T=any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0
type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

export function formatBytes(n: number, post: string = 'B', k=1024) {
    if (isNaN(Number(n)) || n < 0)
        return ''
    let x = ['', 'K', 'M', 'G', 'T']
    let prevMul = 1
    let mul = k
    let i = 0
    while (i < x.length && n > mul) {
        prevMul = mul
        mul *= k
        ++i
    }
    n /= prevMul
    return _.round(n, 1) + ' ' + (x[i]||'') + post
} // formatBytes

export function prefix(pre:string, v:string|number|undefined|null|false, post:string='') {
    return v ? pre+v+post : ''
}

export function wait(ms: number) {
    return new Promise(res=> setTimeout(res,ms))
}

export function getCookie(name: string) {
    const pre = name + '='
    let decodedCookie = decodeURIComponent(document.cookie)
    let ca = decodedCookie.split(';')
    for (let c of ca) {
        c = c.trim()
        if (c.startsWith(pre))
            return c.substring(pre.length, c.length)
    }
    return ''
}

export function objSameKeys<T,R>(src: Record<string,T>, newValue:(value:T,key:string)=>R) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k)]))
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


// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'
export * from './react'
export * from './dialogs'

export type Dict<T=any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0
type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

export function formatBytes(n: number, { post='B', k=1024, digits=NaN }={}) {
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
    const ns = !i || isNaN(digits) ? _.round(n, isNaN(digits) ? 1 : digits) // _.round will avoid useless fractional zeros when `digits is unspecified or no multiplier was used
        : n.toFixed(digits)
    return ns + ' ' + (x[i]||'') + post
} // formatBytes

export function prefix(pre:string, v:string|number|undefined|null|false, post:string='') {
    return v ? pre+v+post : ''
}

export function wait(ms: number) {
    return new Promise(res=> setTimeout(res,ms))
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

export async function srpSequence(username:string, password:string, apiCall: (cmd:string, params:any) => any) {
    const { pubKey, salt } = await apiCall('loginSrp1', { username })
    if (!salt) throw Error('salt')
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const srp = new SRPClientSession(srp6aNimbusRoutines);
    const resStep1 = await srp.step1(username, password)
    const resStep2 = await resStep1.step2(BigInt(salt), BigInt(pubKey))
    const res = await apiCall('loginSrp2', { pubKey: String(resStep2.A), proof: String(resStep2.M1) }) // bigint-s must be cast to string to be json-ed
    await resStep2.step3(BigInt(res.proof)).catch(() => Promise.reject('trust'))
    return res
}


// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useCallback, useState } from 'react'
import { Spinner } from './components'
import { newDialog } from './dialog'
import { Icon } from './icons'

export type Falsy = false | null | undefined | '' | 0

export type Dict = Record<string, any>

export function hIcon(name: string, props?:any) {
    return h(Icon, { name, ...props })
}

export function hError(err: Error | string | null) {
    return err && h('div', { className:'error-msg' }, typeof err === 'string' ? err : err.message)
}

export function formatBytes(n: number, post: string = 'B') {
    if (isNaN(Number(n)))
        return ''
    let x = ['', 'K', 'M', 'G', 'T']
    let prevMul = 1
    let mul = 1024
    let i = 0
    while (i < x.length && n > mul) {
        prevMul = mul
        mul *= 1024
        ++i
    }
    n /= prevMul
    return round(n, 1) + ' ' + (x[i]||'') + post
} // formatBytes

export function round(v: number, decimals: number = 0) {
    decimals = Math.pow(10, decimals)
    return Math.round(v * decimals) / decimals
} // round

export function prefix(pre:string, v:string|number|undefined|null|false, post:string='') {
    return v ? pre+v+post : ''
}

export function wait(ms: number) {
    return new Promise(res=> setTimeout(res,ms))
}

export function waitFor<T>(cb:()=>T, ms:number=200) : Promise<Exclude<T,Falsy>> {
    return new Promise(resolve=>{
        let h: NodeJS.Timeout
        if (go())
            h = setInterval(go, ms)

        function go() {
            const v = cb()
            if (!v) return true
            // @ts-ignore  we know it's not falsy
            resolve(v)
            clearInterval(h)
        }
    })
}

let isWorking = false // we want the 'working' thing to be singleton
export function working() {
    if (isWorking)
        return ()=>{} // noop
    isWorking = true
    return newDialog({
        closable: false,
        noFrame: true,
        Content: Spinner,
        reserveClosing: true,
        className: 'working',
        onClose(){
            isWorking = false
        }
    })
}

export function useForceUpdate(): [()=>void, number] {
    const [n, setN] = useState(0)
    return [ useCallback(()=> setN(n => n+1), [setN]), n ]
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

export function hfsEvent(name: string, params?:Dict) {
    const output: any[] = []
    document.dispatchEvent(new CustomEvent('hfs.'+name, { detail:{ params, output } }))
    return output
}

const HFS: any = (window as any).HFS = {}

HFS.onEvent = (name: string, cb: (params:any, output:any) => any) => {
    document.addEventListener('hfs.' + name, ev => {
        const { params, output } = (ev as CustomEvent).detail
        const res = cb(params, output)
        if (res !== undefined && Array.isArray(output))
            output.push(res)
    })
}

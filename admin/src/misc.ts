import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { CircularProgress } from '@mui/material'

export type Dict<T = any> = Record<string, T>
export type Falsy = false | null | undefined | '' | 0

export function spinner() {
    return h(CircularProgress)
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

export function usePrevious(value: any) {
    const ref = useRef(value)
    const ret = ref.current
    ref.current = value
    return ret
}

export function getOrSet<T>(o:any, k:string, creator:()=>T): T {
    return k in o ? o[k]
        : (o[k] = creator())
}

export function formatBytes(n: number, post: string = 'B') {
    if (isNaN(Number(n)) || n < 0)
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

export function objSameKeys<T,R>(src: Record<string,T>, newValue:(value:T,key:string)=>R) {
    return Object.fromEntries(Object.entries(src).map(([k,v]) => [k, newValue(v,k)]))
}

export function enforceFinal(sub:string, s:string) {
    return !s || s.endsWith(sub) ? s : s+sub
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export function useIsMounted() {
    const mountRef = useRef(true)
    useEffect(() => () => {
        mountRef.current = false
    }, [])
    return useCallback(()=> mountRef.current, [mountRef])
}

export function useStateMounted<T>(init: T) {
    const isMounted = useIsMounted()
    const [v, set] = useState(init)
    const setIfMounted = useCallback((x:T) => {
        if (isMounted())
            set(x)
    }, [isMounted, set])
    return [v, setIfMounted, isMounted] as [T, typeof setIfMounted, typeof isMounted]
}

import { createElement as h, Fragment, FunctionComponent, ReactElement,
    ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { CircularProgress, IconButton, Link, Tooltip } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'

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
    const mountRef = useRef(false)
    useEffect(() => {
        mountRef.current = true
        return () => {
            mountRef.current = false
        }
    }, [])
    return useCallback(()=> mountRef.current, [mountRef])
}

export function useStateMounted<T>(init: T) {
    const isMounted = useIsMounted()
    const [v, set] = useState(init)
    const setIfMounted = useCallback((newValue:T | ((previous:T)=>T)) => {
        if (isMounted())
            set(newValue)
    }, [isMounted, set])
    return [v, setIfMounted, isMounted] as [T, typeof setIfMounted, typeof isMounted]
}

export function isEqualLax(a: any,b: any): boolean {
    return a == b //eslint-disable-line
        || (a && b && typeof a === 'object' && typeof b === 'object'
            && Object.entries(a).every(([k,v]) => isEqualLax(v, b[k])) )
}

type Truthy<T> = T extends false | '' | 0 | null | undefined ? never : T

export function truthy<T>(value: T): value is Truthy<T> {
    return Boolean(value)
}

export function onlyTruthy<T>(arr: T[]) {
    return arr.filter(truthy)
}

export function IconBtn({ title, icon, ...rest }: { title?: string, icon:FunctionComponent, [rest:string]:any }) {
    const ret = h(IconButton, { ...rest }, h(icon))
    return title ? h(Tooltip, { title, children: ret }) : ret
}

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

export function reactFilter(elements: any[]) {
    return elements.filter(x=> x===0 || x && (!Array.isArray(x) || x.length))
}

export function reactJoin(joiner: string | ReactElement, elements: Parameters<typeof reactFilter>[0]) {
    const ret = []
    for (const x of reactFilter(elements))
        ret.push(x, joiner)
    ret.splice(-1,1)
    return dontBotherWithKeys(ret)
}

export function dontBotherWithKeys(elements: ReactNode[]): (ReactNode|string)[] {
    return elements.map((e,i)=>
        !e || typeof e === 'string' ? e
            : Array.isArray(e) ? dontBotherWithKeys(e)
                : h(Fragment, { key:i, children:e }) )
}

export function InLink(props:any) {
    return h(Link, { component: RouterLink, ...props })
}

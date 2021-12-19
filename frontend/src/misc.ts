import { createElement as h } from 'react'

export type Falsy = false | null | undefined | '' | 0

export function hIcon(name: string) {
    return h(Icon, { name })
}

export function hError(err: Error) {
    return h('div', { className:'error-msg' }, err.message)
}

const SYS_ICONS: Record<string,string> = {
    login: 'person',
    user: 'account_circle',
    file: 'description',
    spinner: 'sports_baseball',
}
export function Icon({ name, ...props }: { name:string }) {
    name = SYS_ICONS[name] || name
    return h('span',{
        className: 'material-icons-outlined icon',
        ...props
    }, name)
}

export function Loading() {
    return h(Spinner)
}

export function Spinner() {
    return h(Icon, { name:'spinner', style: { animation:'1s spin infinite' } })
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

export function prefix(pre:string, v:string|number, post:string='') {
    return v ? pre+v+post : ''
}

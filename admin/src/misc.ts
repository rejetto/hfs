// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, FC, ReactNode } from 'react'
import { Box, CircularProgress, IconButton, Link, Tooltip } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { SxProps } from '@mui/system'
import { SvgIconComponent } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'
import { apiCall } from './api'
import { onlyTruthy, useStateMounted } from '@hfs/shared'
export * from '@hfs/shared'

export function spinner() {
    return h(CircularProgress)
}

export function isWindowsDrive(s?: string) {
    return s && /^[a-zA-Z]:$/.test(s)
}

export function isEqualLax(a: any,b: any): boolean {
    return a == b //eslint-disable-line
        || (a && b && typeof a === 'object' && typeof b === 'object'
            && Object.entries(a).every(([k,v]) => isEqualLax(v, b[k])) )
}

export function modifiedSx(is: boolean) {
    return is ? { outline: '2px solid' } : undefined
}

interface IconBtnProps {
    title?: ReactNode
    icon: SvgIconComponent
    disabled?: boolean | string
    progress?: boolean | number
    link?: string
    confirm?: string
    [rest: string]: any
}

export function IconBtn({ title, icon, onClick, disabled, progress, link, tooltipProps, confirm, ...rest }: IconBtnProps) {
    const [loading, setLoading] = useStateMounted(false)
    if (typeof disabled === 'string')
        title = disabled
    if (link)
        onClick = () => window.open(link)
    let ret: ReturnType<FC> = h(IconButton, {
        disabled: Boolean(loading || progress || disabled),
        ...rest,
        async onClick() {
            if (confirm && !await confirmDialog(confirm)) return
            const ret = onClick?.apply(this,arguments)
            if (ret && ret instanceof Promise) {
                setLoading(true)
                ret.catch(alertDialog).finally(()=> setLoading(false))
            }
        }
    }, h(icon))
    if ((progress || loading) && progress !== false) // false is also useful to inhibit behavior with loading
        ret = h(Box, { position:'relative', display: 'inline-block' },
            h(CircularProgress, {
                ...(typeof progress === 'number' ? { value: progress*100, variant: 'determinate' } : null),
                style: { position:'absolute', top: 4, left: 4, width: 32, height: 32 }
            }),
            ret
        )
    if (title)
        ret = h(Tooltip, { title, ...tooltipProps, children: h('span',{},ret) })
    return ret
}

export function iconTooltip(icon: SvgIconComponent, tooltip: string, sx?: SxProps) {
    return h(Tooltip, { title: tooltip, children: h(icon, { sx }) })
}

export function InLink(props:any) {
    return h(Link, { component: RouterLink, ...props })
}

export function Center(props: any) {
    return h(Box, { display:'flex', height:'100%', width:'100%', justifyContent:'center', alignItems:'center', ...props })
}

export async function manipulateConfig(k: string, work:(data:any) => any) {
    const cfg = await apiCall('get_config', { only: [k] })
    const was = cfg[k]
    const will = await work(was)
    if (JSON.stringify(was) !== JSON.stringify(will))
        await apiCall('set_config', { values: { [k]: will } })
}

export function typedKeys<T>(o: T) {
    return Object.keys(o) as (keyof T)[]
}

export function dirname(s: string) {
    let i = s.lastIndexOf('/')
    if (i < 0)
        i = s.lastIndexOf('\\')
    return i < 0 ? '' : s.slice(0, i)
}

export function isAbsolutePath(s: string) {
    return s && (s[0] === '/' || isWindowsDrive(s.slice(0,2)))
}

export function pathJoin(...args: any[]) {
    const delimiter = findFirst(args, x => /\\|\//.exec('\\a/b')?.[0])
    const good = onlyTruthy(args.map(x => x == null ? '' : String(x)))
    return good.map((x, i) => i === good.length-1 || x.endsWith('\\') || x.endsWith('/') ? x : x + delimiter)
        .join('')
}

export function findFirst<I=any, O=any>(a: I[], cb:(v:I)=>O): any {
    for (const x of a) {
        const ret = cb(x)
        if (ret !== undefined)
            return ret
    }
}

export function xlate(input: any, table: Record<string, any>) {
    return table[input] ?? input
}

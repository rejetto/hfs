// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Box, CircularProgress, IconButton, Link, Tooltip } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { SxProps } from '@mui/system'
import { SvgIconComponent } from '@mui/icons-material'
import { alertDialog } from './dialog'
import { apiCall } from './api'
import { useStateMounted } from '@hfs/shared'
import {} from '@hfs/shared' // without this we get weird warnings by webpack
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

export function IconBtn({ title, icon, onClick, ...rest }: { title?: string, icon: SvgIconComponent, [rest:string]:any }) {
    const [loading, setLoading] = useStateMounted(false)
    const ret = h(IconButton, {
        disabled: loading,
        ...rest,
        onClick() {
            const ret = onClick?.apply(this,arguments)
            if (ret && ret instanceof Promise) {
                setLoading(true)
                ret.catch(alertDialog).finally(()=> setLoading(false))
            }
        }
    }, h(icon))
    return title ? h(Tooltip, { title, children: ret }) : ret
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

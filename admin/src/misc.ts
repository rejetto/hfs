// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Box, CircularProgress, IconButton, Link, Tooltip } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { SxProps } from '@mui/system'
import { SvgIconComponent } from '@mui/icons-material'
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

export function IconBtn({ title, icon, ...rest }: { title?: string, icon: SvgIconComponent, [rest:string]:any }) {
    const ret = h(IconButton, { ...rest }, h(icon))
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


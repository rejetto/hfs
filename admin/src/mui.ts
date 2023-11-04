// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt
// all content here is shared between client and server

import { Refresh, SvgIconComponent } from '@mui/icons-material'
import { SxProps } from '@mui/system'
import { createElement as h, FC, forwardRef, Fragment, ReactNode } from 'react'
import { Box, BoxProps, Breakpoint, ButtonProps, CircularProgress, IconButton, IconButtonProps, Link, LinkProps,
    Tooltip, TooltipProps, useMediaQuery } from '@mui/material'
import { formatPerc, WIKI_URL } from '../../src/cross'
import { dontBotherWithKeys, useStateMounted } from '@hfs/shared'
import { Promisable } from '@hfs/mui-grid-form'
import { alertDialog, confirmDialog, toast } from './dialog'
import { LoadingButton, LoadingButtonProps } from '@mui/lab'
import { Link as RouterLink } from 'react-router-dom'

export function spinner() {
    return h(CircularProgress)
}

// return true if same size or larger
export function useBreakpoint(breakpoint: Breakpoint) {
    return useMediaQuery((theme: any) => theme.breakpoints.up(breakpoint), { noSsr:true }) // without noSsr, first execution always returns false
}

interface IconProgressProps {
    icon: SvgIconComponent,
    progress: number,
    offset?: number,
    sx?: SxProps,
    addTitle?: ReactNode
}
export function IconProgress({ icon, progress, offset, addTitle, sx }: IconProgressProps) {
    return h(Fragment, {},
        h(icon, { sx: { position:'absolute', ml: '4px' } }),
        h(CircularProgress, {
            value: progress * 100,
            variant: 'determinate',
            size: 32,
            sx: { position: 'absolute' },
        }),
        h(Tooltip, {
            title: h(Fragment, {}, formatPerc(progress), addTitle),
            children: h(CircularProgress, {
                color: 'success',
                value: (offset || 1e-7) * 100,
                variant: 'determinate',
                size: 32,
                sx: { display: 'flex', ...sx }, // workaround: without this the element has 0 width when the space is crammy (monitor/file)
            }),
        })
    )
}

export function Flex({ gap='.8em', vert=false, center=false, children=null, props={}, ...rest }) {
    return h(Box, {
        sx: {
            display: 'flex',
            gap,
            flexDirection: vert ? 'column' : undefined,
            alignItems: vert ? undefined : 'center',
            ...center && { justifyContent: 'center' },
            ...rest,
        },
        ...props
    }, children)
}


export function wikiLink(uri: string, content: ReactNode) {
    if (Array.isArray(content))
        content = dontBotherWithKeys(content)
    return h(Link, { href: WIKI_URL + uri, target: 'help' }, content)
}

export function reloadBtn(onClick: any, props?: any) {
    return h(IconBtn, { icon: Refresh, title: "Reload", onClick, ...props })
}

export function modifiedSx(is: boolean) {
    return is ? { outline: '2px solid' } : undefined
}
interface IconBtnProps extends Omit<IconButtonProps, 'disabled'|'title'|'onClick'> {
    title?: ReactNode
    icon: SvgIconComponent
    disabled?: boolean | string
    progress?: boolean | number
    link?: string
    confirm?: string
    doneMessage?: boolean | string // displayed only if the result of onClick !== false
    tooltipProps?: Partial<TooltipProps>
    onClick: (...args: Parameters<NonNullable<IconButtonProps['onClick']>>) => Promisable<any>
}

export const IconBtn = forwardRef(({ title, icon, onClick, disabled, progress, link, tooltipProps, confirm, doneMessage, sx, ...rest }: IconBtnProps, ref: any) => {
    const [loading, setLoading] = useStateMounted(false)
    if (typeof disabled === 'string')
        title = disabled
    if (link)
        onClick = () => window.open(link)
    let ret: ReturnType<FC> = h(IconButton, {
            ref,
            disabled: Boolean(loading || progress || disabled),
            ...rest,
            sx: { height: 'fit-content', ...sx },
            async onClick(...args) {
                if (confirm && !await confirmDialog(confirm)) return
                const ret = onClick?.apply(this,args)
                if (ret && ret instanceof Promise) {
                    setLoading(true)
                    ret.then(x => x !== false && execDoneMessage(doneMessage), alertDialog).finally(()=> setLoading(false))
                }
            }
        },
        (progress || loading) && progress !== false  // false is also useful to inhibit behavior with loading
        && h(CircularProgress, {
            ...(typeof progress === 'number' ? { value: progress*100, variant: 'determinate' } : null),
            style: { position:'absolute', top: '10%', left: '10%', width: '80%', height: '80%' }
        }),
        h(icon)
    )
    if (title)
        ret = h(Tooltip, { title, ...tooltipProps, children: h('span',{},ret) })
    return ret
})

interface BtnProps extends Omit<LoadingButtonProps,'disabled'|'title'|'onClick'> {
    icon?: SvgIconComponent
    title?: ReactNode
    disabled?: boolean | string
    progress?: boolean | number
    link?: string
    confirm?: boolean | string
    labelFrom?: Breakpoint
    doneMessage?: boolean | string // displayed only if the result of onClick !== false
    tooltipProps?: TooltipProps
    onClick: (...args: Parameters<NonNullable<ButtonProps['onClick']>>) => Promisable<any>
}
export function Btn({ icon, title, onClick, disabled, progress, link, tooltipProps, confirm, doneMessage, labelFrom, children, ...rest }: BtnProps) {
    const [loading, setLoading] = useStateMounted(false)
    if (typeof disabled === 'string') {
        title = disabled
        disabled = true
    }
    if (link)
        onClick = () => window.open(link)
    const showLabel = useBreakpoint(labelFrom || 'xs')
    let ret: ReturnType<FC> = h(LoadingButton, {
        variant: 'contained',
        startIcon: icon && h(icon),
        loading: Boolean(loading || progress),
        loadingPosition: icon && 'start',
        loadingIndicator: typeof progress !== 'number' ? undefined
            : h(CircularProgress, { size: '1rem', value: progress*100, variant: 'determinate' }),
        disabled,
        ...rest,
        children: showLabel && children,
        sx: {
            ...rest.sx,
            ...!showLabel && {
                minWidth: 'auto',
                px: 2,
                py: '7px',
                '& span': { mx:0 },
            }
        },
        async onClick(...args) {
            if (confirm && !await confirmDialog(confirm === true ? "Are you sure?" : confirm)) return
            const ret = onClick?.apply(this,args)
            if (ret && ret instanceof Promise) {
                setLoading(true)
                ret.then(x => x !== false && execDoneMessage(doneMessage), alertDialog)
                    .finally(()=> setLoading(false))
            }
        }
    })
    if (title)
        ret = h(Tooltip, { title, ...tooltipProps, children: h('span',{},ret) })
    return ret
}

function execDoneMessage(msg: boolean | string | undefined) {
    if (msg)
        toast(msg === true ? "Operation completed" : msg, 'success')
}

export function iconTooltip(icon: SvgIconComponent, tooltip: ReactNode, sx?: SxProps) {
    return h(Tooltip, { title: tooltip, children: h(icon, { sx: { verticalAlign: 'bottom', ...sx } }) })
}

export function InLink(props:any) {
    return h(Link, { component: RouterLink, ...props })
}

export const Center = forwardRef((props: BoxProps, ref) =>
    h(Box, { ref, display:'flex', height:'100%', width:'100%', justifyContent:'center', alignItems:'center',  flexDirection: 'column', ...props }))

export function LinkBtn({ ...rest }: LinkProps) {
    return h(Link, { ...rest, sx: { cursor: 'pointer', ...rest.sx  } })
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, Dialog as MuiDialog, DialogContent, DialogTitle } from '@mui/material'
import {
    createElement as h,
    isValidElement,
    ReactElement,
    useEffect,
    useRef
} from 'react'
import { Check, Error as ErrorIcon, Info, Warning } from '@mui/icons-material'
import { newDialog, closeDialog, dialogsDefaults, DialogOptions, Dialogs } from '@hfs/shared/lib/dialogs'
export * from '@hfs/shared/lib/dialogs'

dialogsDefaults.Container = Container
function Container(d:DialogOptions) {
    useEffect(()=>{
        ref.current?.focus()
    }, [])
    const ref = useRef<HTMLElement>()
    d = { ...dialogsDefaults, ...d }
    const p = d.padding ? 2 : 0
    return h(MuiDialog, {
        open: true,
        maxWidth: 'lg',
        onClose: ()=> closeDialog(),
    },
        d.title && h(DialogTitle, {}, d.title),
        h(DialogContent, {
            ref,
            ...d.dialogProps,
            sx:{ ...d.dialogProps?.sx, px: p, pb: p }
        }, h(d.Content) )
    )
}

type AlertType = 'error' | 'warning' | 'info' | 'success'

const type2ico = {
    error: ErrorIcon,
    warning: Warning,
    info: Info,
    success: Check,
}

export async function alertDialog(msg: ReactElement | string | Error, type:AlertType='info', icon?: ReactElement) {
    if (msg instanceof Error) {
        msg = String(msg)
        type = 'error'
    }
    return new Promise(resolve => newDialog({
        className: 'dialog-alert-'+type,
        icon: '!',
        onClose: resolve,
        Content
    }))

    function Content(){
        return h(Box, { display:'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
            icon ?? h(type2ico[type], { color:type }),
            isValidElement(msg) ? msg : h('div', {}, String(msg))
        )
    }
}

interface ConfirmOptions { href?: string }
export async function confirmDialog(msg: string, { href }: ConfirmOptions={}) : Promise<boolean> {
    return new Promise(resolve => newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: resolve,
        Content
    }) )

    function Content() {
        return h('div', {},
            h('p', {}, msg),
            h('a', {
                href,
                onClick: () => closeDialog(true),
            }, h(Button, {}, 'Confirm'))
        )
    }
}


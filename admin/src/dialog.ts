import { Button, Dialog as MuiDialog, DialogContent, DialogTitle } from '@mui/material'
import { createElement as h, Fragment, FunctionComponent, ReactElement, ReactNode, useEffect, useRef } from 'react'
import { proxy, useSnapshot } from 'valtio'

interface DialogOptions {
    Content: FunctionComponent,
    closable?: boolean,
    onClose?: (v?:any)=> any,
    className?: string,
    icon?: string | FunctionComponent,
    closableContent?: string | ReactNode,
    reserveClosing?: true
    noFrame?: boolean
    title?: string
    padding?: boolean
    dialogProps?: Record<string, any>,
}

const dialogs = proxy<DialogOptions[]>([])

export const dialogsDefaults = {
    closableContent: 'x',
    padding: true,
}

export function Dialogs() {
    const snap = useSnapshot(dialogs)
    return h(Fragment, {},
        snap.length > 0 && snap.map((d,i) =>
            h(Dialog, { key:i, ...d })))
}

function Dialog(d:DialogOptions) {
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
            ...d.dialogProps,
            sx:{ ...d.dialogProps?.sx, px: p, pb: p }
        }, h(d.Content) )
    )
}

export function newDialog(options: DialogOptions) {
    const $id = Math.random()
    ;(options as any).$id = $id // object identity is not working because of the proxy. This is a possible workaround
    dialogs.push(options)
    return (v?:any) => {
        const i = dialogs.findIndex(x => (x as any).$id === $id)
        if (i < 0) return
        dialogs.splice(i,1)
        options.onClose?.(v)
    }
}

export function closeDialog(v?:any) {
    let i = dialogs.length
    while (i--) {
        const d = dialogs[i]
        if (d.reserveClosing)
            continue
        dialogs.splice(i,1)
        return d.onClose?.(v)
    }
}

type AlertType = 'error' | 'warning' | 'info'

export async function alertDialog(msg: ReactElement | string | Error, type:AlertType='info') {
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
        if (typeof msg === 'string' || msg instanceof Error)
            msg = h('div', {}, String(msg))
        return msg
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


// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, FunctionComponent, ReactNode, useEffect, useRef } from 'react'
import { proxy, useSnapshot } from 'valtio'

export interface DialogOptions {
    Content: FunctionComponent<any>,
    closable?: boolean,
    onClose?: (v?:any)=> any,
    className?: string,
    icon?: string | ReactNode | FunctionComponent,
    closableContent?: string | ReactNode,
    reserveClosing?: true
    noFrame?: boolean
    title?: string
    padding?: boolean
    dialogProps?: Record<string, any>,

    Container?: FunctionComponent<DialogOptions>
}

const dialogs = proxy<DialogOptions[]>([])

export const dialogsDefaults: Partial<DialogOptions> = {
    closableContent: 'x',
    padding: true,
}

export function Dialogs() {
    const snap = useSnapshot(dialogs)
    return h(Fragment, {},
        snap.length > 0 && snap.map((d,i) =>
            h(Dialog, { key:i, ...(d as DialogOptions) })))
}

function Dialog(d:DialogOptions) {
    const ref = useRef<HTMLElement>()
    useEffect(()=>{
        ref.current?.focus()
    }, [])
    d = { ...dialogsDefaults, ...d }
    if (d.Container)
        return h(d.Container, d)
    return h('div', {
            ref,
            className: 'dialog-backdrop '+(d.className||''),
            tabIndex: 0,
            onKeyDown,
            onClick: ()=> closeDialog()
        },
        d.noFrame ? h(d.Content || 'div')
            : h('div', {
                    className: 'dialog',
                    onClick(ev:any){
                        ev.stopPropagation()
                    },
                    ...d.dialogProps,
                },
                d.closable || d.closable===undefined
                    && h('button', {
                        className: 'dialog-icon dialog-closer',
                        onClick() { closeDialog() }
                    }, d.closableContent),
                d.icon && h('div', { className: 'dialog-icon dialog-type' },
                    typeof d.icon === 'function' ? h(d.icon) : d.icon),
                h('div', { className: 'dialog-title' }, d.title),
                h('div', { className: 'dialog-content' }, h(d.Content || 'div'))
            )
    )
}

function onKeyDown(ev:any) {
    if (ev.key === 'Escape') {
        closeDialog()
    }
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


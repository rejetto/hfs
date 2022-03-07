// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactElement, useEffect, useRef } from 'react'
import './dialog.css'
import { newDialog, closeDialog } from 'shared/lib/dialogs'
export * from 'shared/lib/dialogs'

interface PromptOptions { def?:string, type?:string }
export async function promptDialog(msg: string, { def, type }:PromptOptions={}) : Promise<string | null> {
    return new Promise(resolve => newDialog({
        className: 'dialog-prompt',
        icon: '?',
        onClose: resolve,
        Content
    }) )

    function Content() {
        const ref = useRef()
        useEffect(()=>{
            const e = ref.current
            if (!e) return
            const inp = e as HTMLInputElement
            setTimeout(()=> inp.focus(),100)
            if (def)
                inp.value = def
        },[])
        return h('div', {},
            h('p', {}, msg),
            h('input', {
                ref,
                type,
                autoFocus: true,
                onKeyDown(ev: KeyboardEvent) {
                    const { key } = ev
                    if (key === 'Escape')
                        closeDialog(null)
                    if (key === 'Enter') {
                        closeDialog((ev.target as any).value as string)
                    }
                }
            })
        )
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
            msg = h('p', {}, String(msg))
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
            }, h('button', {}, 'Confirm'))
        )
    }
}


// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactElement, ReactNode, useEffect, useRef } from 'react'
import './dialog.css'
import { newDialog, closeDialog } from '@hfs/shared/dialogs'
import _ from 'lodash'
export * from '@hfs/shared/dialogs'

interface PromptOptions { def?:string, type?:string }
export async function promptDialog(msg: string, { def, type }:PromptOptions={}) : Promise<string | null> {
    return new Promise(resolve => newDialog({
        className: 'dialog-prompt',
        icon: '?',
        onClose: resolve,
        Content
    }) )

    function Content() {
        const ref = useRef<HTMLInputElement>()
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
                        return closeDialog(null)
                    if (key === 'Enter')
                        return go()
                }
            }),
            h('div', { style: { textAlign: 'right', marginTop: '.8em' } },
                h('button', {  onClick: go }, "Continue")),
        )

        function go() {
            closeDialog(ref.current?.value)
        }
    }
}

type AlertType = 'error' | 'warning' | 'info'

export async function alertDialog(msg: ReactElement | string | Error, type:AlertType='info') {
    if (msg instanceof Error) {
        msg = msg.message
        type = 'error'
    }
    return new Promise(resolve => newDialog({
        className: 'dialog-alert-'+type,
        title: _.capitalize(type),
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

export interface ConfirmOptions { href?: string, afterButtons?: ReactNode }
export async function confirmDialog(msg: ReactElement | string, { href, afterButtons }: ConfirmOptions={}) : Promise<boolean> {
    if (typeof msg === 'string')
        msg = h('p', {}, msg)
    return new Promise(resolve => newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: resolve,
        Content
    }) )

    function Content() {
        return h('div', {},
            msg,
            h('div', {
                style: {
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '1em'
                },
            },
                h('a', {
                    href,
                    onClick() { closeDialog(true) },
                }, h('button', {}, "Confirm")),
                h('button', {
                    onClick() { closeDialog(false) },
                }, "Don't"),
                afterButtons,
            )
        )
    }
}


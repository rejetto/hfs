// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactElement, ReactNode, useEffect, useRef, useState } from 'react'
import './dialog.css'
import { newDialog, closeDialog, DialogOptions } from '@hfs/shared/dialogs'
import _ from 'lodash'
import { useInterval } from 'usehooks-ts'
import { t } from './i18n'
import { err2msg, pendingPromise } from './misc'
export * from '@hfs/shared/dialogs'

interface PromptOptions extends Partial<DialogOptions> { def?:string, type?:string, trim?: boolean }
export async function promptDialog(msg: string, { def, type, trim=true, ...rest }:PromptOptions={}) : Promise<string | null> {
    return new Promise(resolve => newDialog({
        className: 'dialog-prompt',
        icon: '?',
        onClose: resolve,
        ...rest,
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
        return h('form', {},
            h('label', { htmlFor: 'input' }, msg),
            h('input', {
                ref,
                type,
                name: 'input',
                style: {
                    width: def ? (def.length / 2) + 'em' : 'auto',
                    minWidth: '100%', maxWidth: '100%'
                },
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
                h('button', {  onClick: go }, t`Continue`)),
        )

        function go() {
            let res = ref.current?.value
            if (trim)
                res = res?.trim()
            closeDialog(res)
        }
    }
}

type AlertType = 'error' | 'warning' | 'info'

export function alertDialog(msg: ReactElement | string | Error, type:AlertType='info') {
    if (msg instanceof Error)
        type = 'error'
    const ret = pendingPromise()
    return Object.assign(ret, newDialog({
        className: 'dialog-alert dialog-alert-'+type,
        title: t(_.capitalize(type)),
        icon: '!',
        onClose: ret.resolve,
        Content
    }))

    function Content(){
        if (msg instanceof Error)
            msg = h('div', {}, err2msg(msg),
                h('div', { style: { marginTop: 20, fontSize: 'small' } }, msg.message) )
        if (typeof msg === 'string')
            msg = h('p', {}, msg)
        return msg
    }
}

export interface ConfirmOptions extends Partial<DialogOptions> {
    href?: string
    afterButtons?: ReactNode
    timeout?: number
    timeoutConfirm?: boolean
}
export function confirmDialog(msg: ReactElement | string, options: ConfirmOptions={}) {
    const { href, afterButtons, timeout, timeoutConfirm=false, ...rest } = options
    if (typeof msg === 'string')
        msg = h('p', {}, msg)
    const ret = pendingPromise<boolean>()
    const dialog = newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: ret.resolve,
        ...rest,
        Content
    })
    return Object.assign(ret, dialog)

    function Content() {
        const [sec,setSec] = useState(Math.ceil(timeout||0))
        useInterval(() => setSec(x => Math.max(0, x-1)), 1000)
        const missingText = timeout!>0 && ` (${sec})`
        useEffect(() => {
            if (timeout && !sec)
                dialog.close(timeoutConfirm)
        }, [sec])
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
                    onClick() { dialog.close(true) },
                }, h('button', {}, t`Confirm`, timeoutConfirm && missingText)),
                h('button', {
                    onClick() { dialog.close(false) },
                }, t`Don't`, !timeoutConfirm && missingText),
                afterButtons,
            )
        )
    }
}


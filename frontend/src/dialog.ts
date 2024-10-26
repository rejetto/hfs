// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactElement, ReactNode, useEffect, useRef, useState, KeyboardEvent,
    InputHTMLAttributes } from 'react'
import './dialog.css'
import { newDialog, closeDialog, DialogOptions, dialogsDefaults } from '@hfs/shared/dialogs'
import _ from 'lodash'
import { useInterval } from 'usehooks-ts'
import { t } from './i18n'
import { err2msg, isCtrlKey, pendingPromise, Promisable } from './misc'
export * from '@hfs/shared/dialogs'
export { toast } from './toasts'

_.merge(dialogsDefaults, { closableProps: { 'aria-label': t`Close` } })

interface PromptOptions extends Partial<DialogOptions> {
    value?: string,
    type?: string,
    trim?: boolean,
    helperText?: ReactNode,
    inputProps?: Partial<InputHTMLAttributes<string>>
    onSubmit?: (v: string) => Promisable<string>
    onField?: (el: HTMLInputElement | HTMLTextAreaElement) => void
}
export async function promptDialog(msg: string, { value, type, helperText, trim=true, inputProps, onSubmit, onField, ...rest }:PromptOptions={}) : Promise<string | undefined> {
    const textarea = type === 'textarea' && type
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
            if (value)
                inp.value = value
            onField?.(inp)
            if (textarea) {
                function resize() {
                    inp.style.height = 'auto'
                    inp.style.height = (inp.scrollHeight + 5) + 'px'
                }
                setTimeout(resize)
                inp.addEventListener('input', resize)
            }
        }, [textarea])
        return h('form', {},
            h('label', { htmlFor: 'input' }, msg),
            h(textarea || 'input', {
                ref,
                type,
                name: 'input',
                style: {
                    width: value ? (value.length / 2) + 'em' : 'auto',
                    minWidth: '100%', maxWidth: '100%', boxSizing: 'border-box',
                    ...textarea && { width: '30em', maxHeight: '70vh' },
                },
                autoFocus: true,
                onKeyDown(ev: KeyboardEvent) {
                    const { key } = ev
                    if (key === 'Escape')
                        return closeDialog(null)
                    if ((textarea ? isCtrlKey(ev) : key) === 'Enter') {
                        ev.preventDefault()
                        return go()
                    }
                }
            }),
            helperText && h('div', { style: { fontSize: 'smaller', marginTop: '.2em' } }, helperText),
            h('div', { style: { textAlign: 'right', marginTop: '.8em' } },
                h('button', {  onClick: go }, t`Continue`)),
        )

        async function go() {
            let res = ref.current?.value
            if (trim)
                res = res?.trim()
            try {
                if (onSubmit && res !== undefined)
                    res = await onSubmit?.(res) ?? res
                closeDialog(res)
            }
            catch(e: any) {
                alertDialog(e, 'error')
            }
        }
    }
}

export async function formDialog({ ...rest }: DialogOptions): Promise<any> {
    return new Promise<any>(resolve => {
        const { close } = newDialog({
            className: 'dialog-form',
            ...rest,
            onClose: resolve,
            Content() {
                return h('form', {
                    onSubmit(ev: any) {
                        ev.preventDefault()
                        close(Object.fromEntries(new FormData(ev.target).entries()))
                    },
                }, h(rest.Content))
            }
        })
    })
}

export type AlertType = 'error' | 'warning' | 'info'

export function alertDialog(msg: ReactElement | string | Error, type:AlertType='info') {
    if (msg instanceof Error)
        type = 'error'
    const ret = pendingPromise()
    return Object.assign(ret, newDialog({
        className: 'dialog-alert dialog-alert-'+type,
        title: t(_.capitalize(type)),
        icon: '!',
        onClose: ret.resolve,
        dialogProps: { role: 'alertdialog' },
        Content
    }))

    function Content(){
        if (msg instanceof Error) {
            const main = err2msg(msg)
            const sub = msg.message
            msg = h('div', {}, main,
                sub !== main && h('div', { style: { marginTop: 20, fontSize: 'small' } }, sub))
        }
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
    const promise = pendingPromise<boolean>()
    const dialog = newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: promise.resolve,
        ...rest,
        Content
    })
    return Object.assign(promise, dialog)

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
                    tabIndex: -1,
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

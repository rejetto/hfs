// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, CircularProgress, Dialog as MuiDialog, DialogContent, DialogTitle, Modal
} from '@mui/material'
import {
    createElement as h, Dispatch, FC, Fragment, isValidElement, ReactElement, ReactNode, SetStateAction,
    useEffect, useRef, useState
} from 'react'
import { Check, Close, Error as ErrorIcon, Forward, Info, Warning } from '@mui/icons-material'
import { newDialog, closeDialog, dialogsDefaults, DialogOptions, componentOrNode, pendingPromise,
    focusSelector, md, focusableSelector, useIsMobile } from '@hfs/shared'
import { Form, FormProps } from '@hfs/mui-grid-form'
import { IconBtn, Flex, Center } from './mui'
import { useDark } from './theme'
import _ from 'lodash'
import { err2msg } from './misc'
import { useSnapState } from './state'
export * from '@hfs/shared/dialogs'

dialogsDefaults.Container = function Container(d: DialogOptions) {
    const ref = useRef<HTMLElement>()
    const mobile = useIsMobile()
    useEffect(()=> {
        const h = setTimeout(() => {
            const el = ref.current
            if (!el) return
            el.focus()
            if (mobile) return
            focusSelector('[autofocus]', el) || focusSelector(focusableSelector, el)
        })
        return () => clearTimeout(h)
    }, [ref.current])
    const titleSx = useDialogBarColors() // don't move this hook inside the return. When closing+showing at once it throws about rendering with fewer hooks.
    d = { ...dialogsDefaults, ...d }
    const { sx, root, ...rest } = d.dialogProps||{}
    if (d.noFrame)
        return h(Modal, { open: true, children: h(Center, {}, h(d.Content)) })
    return h(MuiDialog, {
        open: true,
        maxWidth: 'lg',
        fullScreen: mobile,
        ...rest,
        ...root,
        className: d.className,
        onClose: ()=> closeDialog(),
    },
        d.title && h(DialogTitle, {
            sx: {
                position: 'sticky', top: 0, p: 1, zIndex: 2, boxShadow: '0 0 8px #0004',
                display: 'flex', alignItems: 'center',
                ...titleSx
            },
        },
            d.icon && componentOrNode(d.icon),
            h(Box, { flex:1, minWidth: 40, ml: 1 }, componentOrNode(d.title)),
            d.closable && h(IconBtn, { icon: Close, title: "Close", onClick: () => closeDialog() }),
        ),
        h(DialogContent, {
            ref,
            sx: {
                p: d.padding ? 1 : 0, pt: '16px !important', overflow: 'initial',
                display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch',
                ...sx,
            }
        }, h(d.Content) )
    )
}

export function useDialogBarColors() {
    const { darkTheme } = useSnapState()
    return darkTheme ?? useDark() ? { bgcolor: '#2d2d2d' } : { bgcolor:'#ccc', color: '#444', }
}

type AlertType = 'error' | 'warning' | 'info' | 'success'

const type2ico = {
    error: ErrorIcon,
    warning: Warning,
    info: Info,
    success: Check,
}
export function alertDialog(msg: ReactElement | string | Error, options?: AlertType | ({ type?:AlertType, icon?: ReactElement } & Partial<DialogOptions>)) {
    const opt = typeof options === 'string' ? { type: options } : (options ?? {})
    let { type='info', ...rest } = opt
    if (msg instanceof Error) {
        msg = msg.message || String(err2msg((msg as any).code))
        type = 'error'
    }

    const promise = pendingPromise()
    const dialog = newDialog({
        className: 'dialog-alert dialog-alert-' + type,
        icon: opt.icon ?? h(type2ico[type], { color: type }),
        onClose: promise.resolve,
        title: _.upperFirst(type),
        dialogProps: { fullScreen: false },
        ...rest,
        Content() {
            return h(Box, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
                isValidElement(msg) ? msg
                    : h(Box, { fontSize: 'large', lineHeight: '1.8em', pb: 1 }, String(msg)),
            )
        }
    })
    return Object.assign(promise, dialog)
}

interface ConfirmOptions extends Omit<DialogOptions, 'Content'> {
    href?: string,
    trueText?: string,
    falseText?: string,
    before?: FC<{ onClick: (result: any) => unknown }>
    after?: FC<{ onClick: (result: any) => unknown }>
}

export function confirmDialog(msg: ReactNode, { href, trueText="Go", falseText="Don't", before, after,  ...rest }: ConfirmOptions={}) {
    const promise = pendingPromise<boolean>()
    const dialog = newDialog({
        className: 'dialog-confirm',
        onClose: promise.resolve,
        dialogProps: { sx: { alignItems: 'center' } },
        ...rest,
        Content
    })
    return Object.assign(promise, dialog)

    function Content() {
        return h(Fragment, {},
            h(Box, { mb: 2 }, typeof msg === 'string' ? md(msg) : msg),
            h(Flex, {},
                before?.({ onClick: (v: any) => dialog.close(v) }),
                h('a', {
                    href,
                    onClick: () => dialog.close(true),
                }, h(Button, { variant: 'contained' }, trueText)),
                h(Button, { onClick: () => dialog.close(false) }, falseText),
                after?.({ onClick: (v: any) => dialog.close(v) }),
            ),
        )
    }
}

type FormDialog<T> = Omit<FormProps<T>, 'values' | 'save' | 'set'>
    & Partial<Pick<FormProps<T>, 'save'>>
    & {
        onChange?: (values:Partial<T>, extra: { setValues: Dispatch<SetStateAction<Partial<T>>> }) => void,
        before?: any
    }
export async function formDialog<T>(
    { form, values, ...options }: Omit<DialogOptions, 'Content'> & {
        values?: Partial<T>,
        form: FormDialog<T> | ((values: Partial<T>) => FormDialog<T>), // allow callback form
    },
) : Promise<T> {
    return new Promise(resolve => {
        const dialog = newDialog({
            className: 'dialog-form',
            onClose: resolve,
            ...options,
            Content() {
                const [curValues, setCurValues] = useState<Partial<T>>(values||{})
                const { onChange, before, ...props } = typeof form === 'function' ? form(curValues) : form
                return h(Fragment, {},
                    before,
                    h(Form, {
                        ...props,
                        values: curValues,
                        set(v, k) {
                            setCurValues(curValues => {
                                const newV = { ...curValues, [k]: v }
                                onChange?.(newV, { setValues: setCurValues })
                                return newV
                            })
                        },
                        save: props.save !== false && {
                            onClick() {
                                dialog.close(curValues)
                            },
                            ...props.save,
                        }
                    })
                )
            }
        })
    })

}

export async function promptDialog(msg: ReactNode, { value='', field, save, addToBar=[], ...props }:any={}) : Promise<string | undefined> {
    return formDialog<{ text: string }>({
        ...props,
        values: { text: value },
        form: {
            fields: [
                { k: 'text', label: null, autoFocus: true, ...field, before: h(Box, { mb: 2 }, msg) },
            ],
            save: {
                children: "Continue",
                startIcon: h(Forward),
                ...save,
            },
            saveOnEnter: true,
            barSx: { gap: 2 },
            addToBar: [
                h(Button, { onClick: closeDialog }, "Cancel"),
                ...addToBar,
            ],
            ...props.form,
        }
    }).then(values => values?.text)
}

export function waitDialog() {
    return newDialog({ Content: () => h(CircularProgress, { size: '20vw'}), noFrame: true, closable: false }).close
}

export function toast(msg: string | ReactElement, type: AlertType | ReactElement='info', options?: Partial<DialogOptions>) {
    const ms = 3000
    const dialog = newDialog({
        ...options,
        Content,
        dialogProps: {
            fullScreen: false,
            PaperProps: {
                sx: { transition: `opacity ${ms}ms ease-in` },
                ref(x: HTMLElement) { // we need to set opacity later, to trigger transition
                    if (x)
                        x.style.opacity = '0'
                }
            }
        }
    })
    setTimeout(dialog.close, ms)
    return dialog

    function Content(){
        return h(Box, { display:'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
            isValidElement(type) ? type : h(type2ico[type], { color:type }),
            isValidElement(msg) ? msg : h('div', {}, String(msg))
        )
    }
}

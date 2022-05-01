// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    Box,
    Button,
    CircularProgress,
    Dialog as MuiDialog,
    DialogContent,
    DialogProps,
    DialogTitle
} from '@mui/material'
import {
    createElement as h, Fragment,
    isValidElement,
    ReactElement,
    useEffect,
    useRef,
    useState
} from 'react'
import { Check, Error as ErrorIcon, Forward, Info, Warning } from '@mui/icons-material'
import { newDialog, closeDialog, dialogsDefaults, DialogOptions } from '@hfs/shared/lib/dialogs'
import { Form, FormProps } from './Form'
export * from '@hfs/shared/lib/dialogs'

dialogsDefaults.Container = function Container(d:DialogOptions) {
    useEffect(()=>{
        ref.current?.focus()
    }, [])
    const ref = useRef<HTMLElement>()
    d = { ...dialogsDefaults, ...d }
    const { sx, root, ...rest } = d.dialogProps||{}
    const p = d.padding ? 2 : 0
    return h(MuiDialog, {
        open: true,
        maxWidth: 'lg',
        ...rest,
        ...root,
        onClose: ()=> closeDialog(),
    },
        d.title && h(DialogTitle, {}, d.title),
        h(DialogContent, {
            ref,
            sx: { ...sx, px: p, pb: p, display: 'flex', flexDirection: 'column', }
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
export async function alertDialog(msg: ReactElement | string | Error, options?: AlertType | ({ type?:AlertType, icon?: ReactElement } & Partial<DialogOptions>)) {
    const opt = typeof options === 'string' ? { type: options } : (options ?? {})
    let { type='info', ...rest } = opt
    if (msg instanceof Error) {
        msg = msg.message || String(msg)
        type = 'error'
    }
    return new Promise(resolve => newDialog({
        className: 'dialog-alert-'+type,
        icon: '!',
        onClose: resolve,
        ...rest,
        Content
    }))

    function Content(){
        return h(Box, { display:'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
            opt.icon ?? h(type2ico[type], { color:type }),
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

type FormDialog<T> = Pick<DialogProps, 'fullScreen' | 'title'>
    & Pick<DialogOptions, 'dialogProps'>
    & Omit<FormProps<T>, 'values' | 'save' | 'set'>
    & Partial<Pick<FormProps<T>, 'values' | 'save'>>
    & {
    onChange?: (values:Partial<T>, extra: { setValues: React.Dispatch<React.SetStateAction<Partial<T>>> }) => void,
    before?: any
}
export async function formDialog<T>({ fullScreen, title, onChange, before, ...props }: FormDialog<T>) : Promise<T> {
    return new Promise(resolve => newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: resolve,
        title,
        Content
    }) )

    function Content() {
        const [values, setValues] = useState<Partial<T>>(props.values||{})
        return h(Fragment, {},
            before,
            h(Form, {
                ...props,
                values,
                set(v, k) {
                    const newV = { ...values, [k]: v }
                    setValues(newV)
                    onChange?.(newV, { setValues })
                },
                save: {
                    ...props.save,
                    onClick() {
                        closeDialog(values)
                    }
                }
            })
        )
    }
}

export async function promptDialog(msg: string, props:any={}) : Promise<string | undefined> {
    return formDialog<{ text: string }>({
        ...props,
        fields: [
            h(Box, {}, msg),
            { k: 'text', label: null, autoFocus: true, ...props.field },
        ],
        save: {
            children: "Continue",
            startIcon: h(Forward),
            ...props.save,
        },
        barSx: { gap: 2 },
        addToBar: [
            h(Button, { onClick: closeDialog }, "Cancel"),
            ...props.addToBar||[],
        ]
    }).then(values => values?.text)
}

export function waitDialog() {
    return newDialog({ Content: CircularProgress, closable: false })
}

export function toast(msg: string | ReactElement, type: AlertType | ReactElement='info') {
    const ms = 3000
    const close = newDialog({
        Content,
        dialogProps: {
            PaperProps: {
                sx: { transition: `opacity ${ms}ms ease-in` },
                ref(x: HTMLElement) { // we need to set opacity later, to trigger transition
                    if (x)
                        x.style.opacity = '0'
                }
            }
        }
    })
    setTimeout(close, ms)

    function Content(){
        return h(Box, { display:'flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
            isValidElement(type) ? type : h(type2ico[type], { color:type }),
            isValidElement(msg) ? msg : h('div', {}, String(msg))
        )
    }
}

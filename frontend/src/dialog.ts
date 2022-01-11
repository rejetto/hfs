import { createElement as h, Fragment, FunctionComponent, ReactElement, ReactNode, useEffect, useRef } from 'react'
import { proxy, useSnapshot } from 'valtio'
import './dialog.css'

interface DialogOptions {
    Content: FunctionComponent,
    closable?: boolean,
    onClose?: (v?:any)=> any,
    className?: string,
    icon?: string | FunctionComponent,
    closableContent?: string | ReactNode,
    reserveClosing?: true
    noFrame?: boolean
}

const dialogs = proxy<DialogOptions[]>([])

export const dialogsDefaults = {
    closableContent: 'x',
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
                }
            },
                d.closable || d.closable===undefined && h('button', { className:'dialog-icon dialog-closer', onClick:()=> closeDialog() }, d.closableContent),
                d.icon && h('div', { className:'dialog-icon dialog-type' }, d.icon),
                h('div', { className:'dialog-content' }, h(d.Content || 'div'))
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
        d.onClose?.(v)
    }
}

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

export async function confirmDialog(msg: string) : Promise<boolean> {
    return new Promise(resolve => newDialog({
        className: 'dialog-confirm',
        icon: '?',
        onClose: resolve,
        Content
    }) )

    function Content() {
        return h('div', {},
            h('p', {}, msg),
            h('button', {
                autoFocus: true,
                onClick(){
                    closeDialog(true)
                }
            }, 'Confirm')
        )
    }
}


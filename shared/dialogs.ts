// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, FunctionComponent, isValidElement, ReactNode, useEffect, useRef } from 'react'
import { proxy, ref, useSnapshot } from 'valtio'
import { isPrimitive, objSameKeys } from '.'

export interface DialogOptions {
    Content: FunctionComponent<any>,
    closable?: boolean,
    onClose?: (v?:any)=> any,
    className?: string,
    icon?: string | ReactNode | FunctionComponent,
    closableContent?: string | ReactNode,
    reserveClosing?: true
    noFrame?: boolean
    title?: ReactNode | FunctionComponent
    padding?: boolean
    position?: [number, number]
    dialogProps?: Record<string, any>
    $id?: number

    Container?: FunctionComponent<DialogOptions>
}

const dialogs = proxy<DialogOptions[]>([])

export const dialogsDefaults: Partial<DialogOptions> = {
    closableContent: 'x',
    padding: true,
}

// focus trapped on current dialog (MUI already does it)
export const focusableSelector = ['input:not([type="hidden"])', 'button', 'select', 'textarea', 'a[href]', '[tabindex]'].map(x =>
    x + ':not([disabled]):not([tabindex="-1"])').join(',')
window.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab') return
    const dialogs = document.querySelectorAll('[role=dialog]')
    const dialog = dialogs[dialogs.length-1]
    if (!dialog) return
    const focusable = dialog.querySelectorAll(focusableSelector)
    const n = focusable.length
    if (!n) return
    const [a, b] = ev.shiftKey ? [n-1, 0] : [0, n-1]
    if (ev.target !== focusable[b] && isDescendant(document.activeElement, dialog)) return // default behavior
    ;(focusable[a] as HTMLElement).focus()
    ev.preventDefault()
})

function isDescendant(child: Node | null, parent: Node) {
    while (child) {
        if (child === parent)
            return true
        child = child.parentNode
    }
    return false
}

export function Dialogs() {
    const snap = useSnapshot(dialogs)
    useEffect(() => {
        document.body.style.overflow = snap.length ? 'hidden' : ''
    }, [snap.length])
    return h(Fragment, {},
        snap.length > 0 && snap.map(d =>
            h(Dialog, { key: d.$id, ...(d as DialogOptions) })))
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
            onClick: (ev: any) =>
                ev.target === ev.currentTarget // this test will tell us if really the backdrop was clicked
                    && closeDialog()
        },
        d.noFrame ? h(d.Content || 'div')
            : h('div', {
                role: 'dialog',
                'aria-modal': true,
                className: 'dialog',
                style: {
                    ...position(),
                    ...d.dialogProps?.style,
                },
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
                d.icon && h('div', { className: 'dialog-icon dialog-type' + (typeof d.icon === 'string' ? ' dialog-icon-text' : '') },
                    componentOrNode(d.icon)),
                h('div', { className: 'dialog-title' }, componentOrNode(d.title)),
                h('div', { className: 'dialog-content' }, h(d.Content || 'div'))
            )
    )

    function position() {
        const { innerWidth: w, innerHeight: h } = window
        const pos = d.position
        return pos && {
            margin: '1em',
            position: 'absolute',
            ...pos[0] < w / 2 ? { left: pos[0] } : { right: w - pos[0] },
            ...pos[1] < h / 2 ? { top: pos[1] } : { bottom: h - pos[1] },
        }
    }
}

export function componentOrNode(x: ReactNode | FunctionComponent) {
    return isPrimitive(x) || isValidElement(x) ? x : h(x as any)
}

function onKeyDown(ev:any) {
    if (ev.key === 'Escape') {
        closeDialog()
    }
}

export function newDialog(options: DialogOptions) {
    const $id = Math.random()
    options.$id = $id // object identity is not working because of the proxy. This is a possible workaround
    options = objSameKeys(options, x => isValidElement(x) ? ref(x) : x) as typeof options // encapsulate elements as react will try to write, but valtio makes them readonly
    dialogs.push(options)
    return { close }

    function close(v?:any) {
        const i = dialogs.findIndex(x => (x as any).$id === $id)
        if (i < 0) return
        return closeDialogAt(i, v)
    }
}

export function closeDialog(v?:any) {
    let i = dialogs.length
    while (i--) {
        const d = dialogs[i]
        if (d.reserveClosing)
            continue
        closeDialogAt(i, v)
        return d
    }
}

function closeDialogAt(i: number, value?: any) {
    const [d] = dialogs.splice(i,1)
    return d?.onClose?.(value)
}
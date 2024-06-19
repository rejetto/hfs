// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, FunctionComponent, isValidElement, ReactNode, useEffect, useRef,
    HTMLAttributes, useState } from 'react'
import { proxy, ref, useSnapshot } from 'valtio'
import { domOn, isPrimitive, objSameKeys, wait } from '.'

export interface DialogOptions {
    Content: FunctionComponent<any>,
    closable?: boolean,
    onClose?: (v?: any) => any,
    closingValue?: any,
    className?: string,
    icon?: string | ReactNode | FunctionComponent,
    closableProps?: any,
    reserveClosing?: true
    noFrame?: boolean
    title?: ReactNode | FunctionComponent
    padding?: boolean
    position?: [number, number]
    dialogProps?: Record<string, any>
    $id?: number
    $opening?: NodeJS.Timeout
    ts?: number
    closed?: Promise<void>

    Container?: FunctionComponent<DialogOptions>
}

const dialogs = proxy<DialogOptions[]>([])
const focusBak: (Element | null)[] = []
const { history } = window

export const dialogsDefaults: Partial<DialogOptions> = {
    closableProps: { children: 'x', 'aria-label': "Close", },
    padding: true,
}

// focus trapped on current dialog (MUI already does it)
export const focusableSelector = ['input:not([type="hidden"])', 'button', 'select', 'textarea', 'a[href]', '[tabindex]'].map(x =>
    x + ':not([disabled]):not([tabindex="-1"])').join(',')
window.addEventListener('keydown', ev => {
    if (ev.key !== 'Tab') return
    if (tabCycle(ev.target, ev.shiftKey))
        ev.preventDefault()
})

function tabCycle(target: EventTarget | null, invert=false) {
    const dialogs = document.querySelectorAll('[role$=dialog]')
    const dialog = dialogs[dialogs.length-1]
    if (!dialog) return
    const focusable = dialog.querySelectorAll(focusableSelector)
    const n = focusable.length
    if (!n) return
    const [a, b] = invert ? [n-1, 0] : [0, n-1]
    if (target !== focusable[b] && isDescendant(document.activeElement, dialog)) return // default behavior
    ;(focusable[a] as HTMLElement).focus()
    return true
}

export function isDescendant(child: Node | null | undefined, parentMatch: Node | null | undefined | ((child: Node) => boolean)) {
    if (!parentMatch) return false
    const fun = typeof parentMatch === 'function'
    while (child) {
        if (fun ? parentMatch(child) : child === parentMatch)
            return true
        child = child.parentNode
    }
    return false
}

let ignorePopState = false
function back() {
    ignorePopState = true
    let was = history.state
    history.back()
    return new Promise<void>(res => {
        const h = setInterval(() => was !== history.state && res() , 10)
        setTimeout(() => clearTimeout(h), 500)
    })
}

;(async () => {
    while (history.state?.$dialog) { // it happens if the user reloads the browser leaving open dialogs
        history.back()
        await wait(1) // history.state is not changed without this, on chrome123
    }
})()

export function Dialogs(props: HTMLAttributes<HTMLDivElement>) {
    useEffect(() => domOn('popstate', () => {
        if (ignorePopState)
            return ignorePopState = false
        const { $dialog } = history.state
        if ($dialog && !dialogs.find(x => x.$id === $dialog)) // it happens if the user, after closing a dialog, goes forward in the history
            return back()
        closeDialog(undefined, true)
    }), [])
    const snap = useSnapshot(dialogs)
    useEffect(() => {
        document.body.style.overflow = snap.length ? 'hidden' : ''
    }, [snap.length])
    return h(Fragment, {},
        h('div', { 'aria-hidden': snap.length > 0, ...props }),
        snap.map(d =>
            h(Dialog, { key: d.$id, ...(d as DialogOptions) })))
}

function Dialog(d: DialogOptions) {
    const ref = useRef<HTMLElement>()
    const [shiftY, setShiftY] = useState(0)
    useEffect(()=>{
        const el = ref.current?.querySelector('.dialog') as HTMLElement | undefined
        if (!el) return
        tabCycle(el) // focus first thing inside dialog. This makes JAWS behave
        if (!d.position) return
        const rect = el.getBoundingClientRect()
        setShiftY(Math.min(0, rect.top, window.innerHeight - rect.bottom))
    }, [])
    d = { closable: true, ...dialogsDefaults, ...d }
    if (d.Container)
        return h(d.Container, d)
    return h('div', {
            ref,
            className: 'dialog-backdrop '+(d.className||''),
            onKeyDown,
            onClick: (ev: any) => d.closable
                && ev.target === ev.currentTarget // this test will tell us if really the backdrop was clicked
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
                d.closable && h('button', {
                    className: 'dialog-icon dialog-closer',
                    onClick() { closeDialog() },
                    ...d.closableProps,
                }),
                d.icon && h('div', {
                    className: 'dialog-icon dialog-type' + (typeof d.icon === 'string' ? ' dialog-icon-text' : ''),
                    'aria-hidden': true,
                }, componentOrNode(d.icon)),
                h('h1', { className: 'dialog-title' }, componentOrNode(d.title)),
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
            ...pos[1] < h / 2 ? { top: shiftY + pos[1] } : { bottom: shiftY + h - pos[1] },
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
    const ts = performance.now()
    options.$id = $id // object identity is not working because of the proxy. This is a possible workaround
    options.ts = ts
    focusBak.push(document.activeElement) // saving this inside options object doesn't work (didn't dig enough to say why)
    options = objSameKeys(options, x => isValidElement(x) ? ref(x) : x) as typeof options // encapsulate elements as react will try to write, but valtio makes them readonly
    options.$opening = setTimeout(() => { // in case dialogs were just closed, account for window.history delay. This should be harmless as ux is unaffected, and programmatically you already didn't expect this to happen immediately but at state change
        dialogs.push(options)
        options = dialogs[dialogs.length - 1] // replace with proxy object, to stay in sync with its changes
        if (options.closable !== false)
            history.pushState({ $dialog: $id, ts, idx: history.state.idx + 1 }, '')
    }, 10) // 10 for firefox, chrome125 seems to be ok with 1
    return { close }

    function close(v?:any) {
        clearTimeout(options.$opening) // in case it was not open yet
        const i = dialogs.findIndex(x => (x as any).$id === $id)
        if (i < 0) return
        if (history.state.$dialog === $id)
            options.closed = back()
        closeDialogAt(i, v)
        return options
    }
}

export function closeDialog(v?:any, skipHistory=false) {
    let i = dialogs.length
    if (dialogs[i - 1]?.closable === false) return
    while (i--) {
        const d = dialogs[i]
        if (d.reserveClosing)
            continue
        if (!skipHistory) {
            if (history.state.$dialog !== d.$id) return
            d.closed = back()
        }
        closeDialogAt(i, v)
        return d
    }
}

function closeDialogAt(i: number, value?: any) {
    const [d] = dialogs.splice(i,1)
    ;(focusBak.pop() as any)?.focus?.() // if element is not HTMLElement, it doesn't have focus method
    d.closingValue = value
    d?.onClose?.(value)
    return d
}

export function anyDialogOpen() {
    return dialogs.length > 0
}
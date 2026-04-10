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
    closed?: Promise<void>
    className?: string,
    icon?: string | ReactNode | FunctionComponent,
    closableProps?: any,
    reserveClosing?: true
    noFrame?: boolean
    title?: ReactNode | FunctionComponent
    padding?: boolean
    position?: [number, number]
    dialogProps?: Record<string, any>
    restoreFocus?: boolean
    Container?: FunctionComponent<DialogOptions>
}

interface Dialog extends DialogOptions {
    $id?: number
    $opening?: NodeJS.Timeout
    ts?: number
    close: (v?: any, skipHistory?: boolean) => undefined | Promise<void>
    closed?: Promise<void | undefined>
    restoreFocus?: any
}

const dialogs = proxy<Dialog[]>([])
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

let waitClosing = Promise.resolve()
let waitQueuedCloses = Promise.resolve()
let ignorePopState = false
async function doBack() {
    ignorePopState = true
    const was = history.state
    return new Promise<void>(async res => {
        const timeout = Date.now() + 1500
        let lastBack = 0
        while (was === history.state) { // history.back seems to not always be effective, so we loop for it
            const now = Date.now()
            if (now > timeout) break // emergency brake
            if (now - lastBack > 1000) { // after this long time we try again
                history.back()
                lastBack = now
            }
            await wait(10) // we wait shorter and loop faster so to exit/resolve asap
        }
        res()
    })
}
async function back() {
    return waitClosing = waitClosing.then(doBack)
}

const BASE_STATE = 1
;(async () => {
    // this condition happens if the user reloads the browser leaving open dialogs. Don't pop BASE_STATE as it may contain other state we inherited
    while (history.state?.$dialog !== undefined && history.state.$dialog !== BASE_STATE) {
        history.back()
        await wait(1) // history.state is not changed without this, on chrome123
    }
})()

export function Dialogs(props: HTMLAttributes<HTMLDivElement>) {
    useEffect(() => domOn('popstate', () => {
        if (ignorePopState)
            return ignorePopState = false
        const d = history.state?.$dialog
        if (d === undefined) return // not my state, not my business
        if (d !== BASE_STATE && !dialogs.find(x => x.$id === d)) // it happens if the user, after closing a dialog, goes forward in the history
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
    const ref = useRef<HTMLElement>(null)
    const [shiftY, setShiftY] = useState(0)
    useEffect(()=>{
        const el = ref.current?.querySelector('.dialog') as HTMLElement | undefined
        if (!el) return
        tabCycle(el) // focus first thing inside dialog. This makes JAWS behave
        ;(el.querySelector('[autofocus]') as HTMLElement)?.focus() // if any
        if (!d.position) return
        // not the nicest of solutions, but short, effective, and used only by short-lived context menus
        let y = 0
        const t = setInterval(() => {
            const rect = el.getBoundingClientRect()
            setShiftY(y = Math.min(y, rect.top, window.innerHeight - rect.bottom + y))
        }, 100)
        return () => clearInterval(t)
    }, [])
    d = { closable: true, ...dialogsDefaults, ...d }
    if (d.Container)
        return h(d.Container, d)
    return h('div', {
            ref,
            className: 'dialog-backdrop '+(d.className||''),
            onKeyDown(ev) {
                if (ev.key === 'Escape')
                    closeDialog()
                ev.stopPropagation()
            },
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
                h('button', {
                    className: 'dialog-icon dialog-closer' + (d.closable ? '' : ' hidden'),
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

export function newDialog(options: DialogOptions) {
    const $id = Math.random()
    const ts = performance.now()
    const d: Dialog = Object.assign(objSameKeys(options, x => isValidElement(x) ? ref(x) : x) as typeof options, { // encapsulate elements as React will try to write, but valtio makes them readonly
        close, ts, $id, // object identity is not working on dialog object because it's proxied (valtio). This is a possible workaround
        restoreFocus: options.restoreFocus ?? ref(document.activeElement || {}),
    })
    let cancelOpening = false
    Promise.all([waitClosing, waitQueuedCloses]).then(() => { // queued closes must settle too, or a new dialog may wait behind a stale close request forever
        if (cancelOpening) return
        if (!dialogs.length) {
            history.replaceState({ ...history.state, $dialog: BASE_STATE }, '')
        }
        dialogs.push(d)
        if (dialogs.at(-1)!.closable !== false) { // use proxy object, to stay in sync with its changes
            // browser-back closes dialogs by walking back to the entry that was current before the first dialog opened
            if (history.state?.$dialog === undefined) {
                history.replaceState({ ...history.state, $dialog: BASE_STATE }, '')
            }
            history.pushState({ $dialog: $id, ts, idx: 1 + (history.state?.idx || 0) }, '')
        }
    })
    return d

    function close(v?:any, skipHistory=true) {
        cancelOpening = true
        const i = dialogs.findIndex(x => (x as any).$id === $id)
        if (i < 0) return
        d.closed = !skipHistory && history.state?.$dialog === $id ? back() : Promise.resolve()
        closeDialogAt(i, v)
        return options.closed
    }
}

export function closeDialog(v?:any, skipHistory=false): Dialog | undefined {
    let i = dialogs.length
    if (dialogs[i - 1]?.closable === false) return
    while (i--) {
        const d = dialogs[i]
        if (d.reserveClosing)
            continue
        if (!skipHistory) {
            if (history.state?.$dialog !== d.$id) {
                // rapid ESC presses can target the next dialog before browser history has caught up with the previous close
                const closed: Promise<void | undefined> = waitQueuedCloses = waitQueuedCloses
                    .then(() => waitClosing)
                    // once the history unwind has already been queued, retry the next close without re-checking the same stale state
                    .then(() => closeDialog(v, true)?.closed)
                // return a promise here so mobile callers wait instead of spinning on the still-open dialog stack
                return { ...d, closed } as Dialog
            }
            d.closed = back()
        }
        closeDialogAt(i, v)
        return d
    }
}

function closeDialogAt(i: number, value?: any) {
    const [d] = dialogs.splice(i,1)
    d.restoreFocus?.focus?.() // if element is not HTMLElement, it doesn't have focus method
    d.closingValue = value && typeof value === 'object' ? ref(value) : value // since this is being assigned to a valtio proxy, ref is necessary to avoid crashing with unusual (and possibly accidental) objects like React's SynteticEvents
    d.closed ??= Promise.resolve()
    d.closed.then(async () => {
        // queued ESC closes can empty the stack before the last synthetic history entry has been unwound
        while (!dialogs.length && history.state?.$dialog !== undefined && history.state.$dialog !== BASE_STATE)
            await doBack()
        d?.onClose?.(value)
    })
    return d
}

export function anyDialogOpen() {
    return dialogs.length > 0
}

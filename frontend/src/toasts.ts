import { createElement as h, HTMLAttributes, isValidElement, ReactElement, useEffect, useState, useRef,
    useCallback, cloneElement, useMemo } from 'react'
import { proxy, useSnapshot } from 'valtio'
import { AlertType } from './dialog'
import { hIcon, pendingPromise } from './misc'
import _ from 'lodash'
import './toasts.scss'

type ToastType = AlertType | 'success'
type Content = string | ReactElement

export function toast(content: Content, type: ToastType='info', { timeout=5_000 }: { timeout?: number } & Omit<ToastOptions, 'id' | 'content' | 'type'>={}) {
    console.debug("toast", content)
    const id = Math.random()
    toasts.push({ id, content, type, close })
    const closed = pendingPromise()
    setTimeout(close, timeout)
    return {
        close,
        closed
    }

    function close() {
        const it = _.find(toasts, { id })
        if (!it) return
        it.closed = true
        closed.resolve()
    }
}

interface ToastOptions extends Omit<Partial<HTMLAttributes<HTMLDivElement>>, 'id' | 'content'> {
    content: Content
    type: ToastType
}
interface ToastRecord extends ToastOptions {
    id: number
    closed?: boolean
    close: () => void
}
const toasts = proxy<ToastRecord[]>([])

export function Toasts() {
    const snap = useSnapshot(toasts)
    return h('div', { className: 'toasts' },
        snap.map(d =>
            h(Toast, { key: d.id, ...(d as any) }))
    )
}

function Toast({ content, type, closed, id, close, ...props }: ToastRecord) {
    const [addClass, setAddClass] = useState('before')
    const [height, setHeight] = useState('')
    useEffect(() => {
        setAddClass(closed ? 'after' : '')
    }, [closed])
    const onTransitionEnd = useCallback(() => {
        const el = ref.current
        if (!addClass && el) // just entered
            setHeight(el.clientHeight + 'px')
        if (addClass === 'after')
            _.remove(toasts, { id })
    }, [addClass])
    const ref = useRef<HTMLDivElement | null>()
    content = useMemo(() => isValidElement(content) ? cloneElement(content) : content, [content]) // proxied elements are frozen, and crash
    return h('div', {
            ...props,
            ref,
            style: { height },
            onTransitionEnd,
            onClick: close,
            className: `toast ${addClass} ${_.isString(type) ? 'toast-' + type : ''} ${props.className || ''}`
        },
        h('div', { className: 'toast-icon' }, isValidElement(type) ? type : hIcon(type)),
        h('div', { className: 'toast-content' }, content)
    )
}
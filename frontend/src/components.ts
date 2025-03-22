// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    Callback, getHFS, hfsEvent, hIcon, Html, isPrimitive, onlyTruthy, prefix, noAriaTitle, formatBytes, useStateMounted
} from './misc'
import {
    ButtonHTMLAttributes, ChangeEvent, createElement as h, CSSProperties, forwardRef, Fragment,
    HTMLAttributes, InputHTMLAttributes, isValidElement, MouseEventHandler, ReactNode, SelectHTMLAttributes,
    useEffect, useMemo, useState, ComponentPropsWithoutRef, LabelHTMLAttributes, useRef, ReactElement
} from 'react'
import _ from 'lodash'
import i18n from './i18n'
const { t } = i18n

export function Spinner(props: any) {
    return hIcon('spinner', { className:'spinner', ...props })
}

interface FlexProps extends CSSProperties {
    gap?: CSSProperties['gap'],
    center?: boolean,
    vert?: boolean,
    children?: ReactNode,
    className?: string,
    props?: HTMLAttributes<HTMLDivElement>
}
export const Flex = forwardRef(({ gap='.8em', center=false, vert=false, children=null, className='', props={}, ...rest }: FlexProps, ref) =>
    h('div', {
        ref,
        className,
        style: {
            display: 'flex',
            gap,
            flexDirection: vert ? 'column' : undefined,
            alignItems: vert ? undefined : 'center',
            justifyContent: center ? 'center' : undefined,
            ...rest,
        },
        ...props
    }, children) )

export const FlexV = forwardRef((props: FlexProps, ref) => h(Flex, { ref, vert: true, ...props }))

interface CheckboxProps extends Omit<Partial<InputHTMLAttributes<any>>, 'onChange'> {
    children?: ReactNode,
    value?: any,
    onChange?: (v: boolean, ev: ChangeEvent) => void
    labelProps?: LabelHTMLAttributes<any>
    id?: string
}

export const Checkbox = forwardRef(({ onChange, value, children, labelProps, id, ...props }: CheckboxProps, ref) => {
    const ret = h('input', {
        ref,
        type: 'checkbox',
        onChange: (ev:  ChangeEvent<HTMLInputElement>) => onChange?.(Boolean(ev.target.checked), ev),
        ...value !== undefined && { checked: Boolean(value) },
        value: 1,
        id: children ? undefined : id,
        ...props
    })
    return !children ? ret : h('label', { id, ...labelProps }, ret, children)
})

interface SelectProps<T> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
    value: T, // just string for the time being
    onChange?: (v: T) => void,
    options: { label: string, value: T }[]
}
export function Select<T extends string>({ onChange, value, options, ...props }: SelectProps<T>) {
    return h('select', {
        onChange: ev =>
            onChange?.((ev.target as any).value),
        value,
        ...props,
    }, options.map(({ value, label }) => h('option', { key: value, value }, label)))
}

// @param render always gets a truthy, even with empty children will get empty array, unless the custom-code is requiring to cancel the whole entry
export function CustomCode({ name, children, render, ...props }: {
    name: string,
    children?: ReactNode,
    render?: Callback<ReactNode, ReactNode>
    [k :string]: any,
}) {
    const raw = useMemo(() => hfsEvent(name, Object.assign(props, { def: children })), // not using 'default' as key, because user can have unexpected error destructuring object
        [name, children, ...props ? Object.values(props) : []])
    const [out, setOut] = useStateMounted<null | ReactNode[]>([])
    useEffect(() => {
        if (raw.some(x => x === null)) // null means skip this
            return setOut(null)
        const worked: ReactNode[] = raw.map(toElement)
        setOut(onlyTruthy(worked))
        raw.forEach((x, i) => {
            if (typeof x?.then === 'function') // thenable
                x.then((resolved: any) => {
                    worked[i] = toElement(resolved, i)
                    setOut(onlyTruthy(worked))
                }, () => {})
        })
        const html = getHFS().customHtml?.[name]
        if (html?.trim?.()) {
            worked.push(toElement(html, -1))
            setOut(onlyTruthy(worked))
        }

        function toElement(x: unknown, key: number) {
            return isValidElement(x) ? h(Fragment, { key }, x) // wrap to avoid console warnings
                : x === 0 || x && isPrimitive(x) ? h(Html, { key }, String(x))
                    : _.isArray(x) ? h(Fragment, { key }, ...x)
                        : null
        }
    }, [raw])
    render ??= _.identity
    return h(Fragment, {}, render(out && (out?.length || !children ? out : children)) )
}

interface IconBtnOptions extends ButtonHTMLAttributes<any> { style?: any, title?: string }
export function iconBtn(icon: string, onClick: MouseEventHandler, { title, ...props }: IconBtnOptions={}) {
    return h('button', {
        title: title ?? t(_.capitalize(icon)),
        onClick,
        ...props,
        className: 'icon-button',
    }, icon.length > 1 ? hIcon(icon) : icon )
}

export interface BtnProps extends ComponentPropsWithoutRef<"button"> {
    icon?: string | ReactElement,
    label: string,
    tooltip?: string,
    toggled?: boolean,
    className?: string,
    onClick?: () => unknown
    onClickAnimation?: boolean
    asText?: boolean
    successFeedback?: boolean
}

export function Btn({ icon, label, tooltip, toggled, onClick, onClickAnimation, asText, successFeedback, ...rest }: BtnProps) {
    const [working, setWorking] = useState(false)
    const [success, setSuccess] = useState(false)
    const t = useRef<any>()
    return h(asText ? 'a' : 'button', {
        title: label + prefix(' - ', tooltip),
        'aria-label': label,
        'aria-pressed': toggled,
        onClick(ev) {
            if (asText)
                ev.preventDefault()
            if (!onClick) return
            if (onClickAnimation !== false)
                setWorking(true)
            Promise.resolve(onClick()).finally(() => setWorking(false))
                .then(() => {
                    if (!successFeedback) return
                    setSuccess(true)
                    clearTimeout(t.current)
                    t.current = setTimeout(() => setSuccess(false), 1000)
                })
        },
        ...rest,
        ...asText ? { role: 'button', style: { cursor: 'pointer', ...rest.style } } : undefined,
        className: [rest.className, toggled && 'toggled', working && 'ani-working', success && 'success'].filter(Boolean).join(' '),
    }, icon && (isValidElement(icon) ? icon : hIcon(icon)),
        h('span', { className: 'label' }, label) ) // don't use <label> as VoiceOver will get redundant
}

export function Bytes({ bytes, ...props }: { bytes: number } & HTMLAttributes<HTMLSpanElement>) {
    return h('span', { ...noAriaTitle(bytes.toLocaleString()), ...props }, formatBytes(bytes))
}
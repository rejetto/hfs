// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getHFS, hfsEvent, hIcon, Html, isPrimitive, onlyTruthy, prefix } from './misc'
import { ButtonHTMLAttributes, ChangeEvent, createElement as h, CSSProperties, forwardRef, Fragment,
    HTMLAttributes, InputHTMLAttributes, isValidElement, MouseEventHandler, ReactNode, SelectHTMLAttributes,
    useMemo, useState, ComponentPropsWithoutRef } from 'react'
import _ from 'lodash'
import { t } from './i18n'

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
    value: any,
    onChange?: (v: boolean, ev: ChangeEvent) => void
}
export function Checkbox({ onChange, value, children, ...props }: CheckboxProps) {
    const ret = h('input', {
        type: 'checkbox',
        onChange: ev => onChange?.(Boolean(ev.target.checked), ev),
        checked: Boolean(value),
        value: 1,
        ...props
    })
    return !children ? ret : h('label', {}, ret, children)
}

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

export function CustomCode({ name, children, ...props }: { name: string, children?: ReactNode } & any) {
    const result = useMemo(() => {
        props.def = children // not using 'default' because user can have unexpected error destructuring object
        const ret = onlyTruthy(hfsEvent(name, props)
            .map((x, key) => isValidElement(x) ? h(Fragment, { key }, x)
                : x === 0 || x && isPrimitive(x) ? h(Html, { key }, String(x))
                    : _.isArray(x) ? h(Fragment, { key }, ...x)
                        : null))
        const html = getHFS().customHtml?.[name]
        if (html?.trim?.())
            ret.push(h(Html, { key: 'x' }, html))
        return ret
    }, [name, children, ...props ? Object.values(props) : []])
    return result.length || !children ? h(Fragment, {}, result) : children
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
    icon?: string,
    label: string,
    tooltip?: string,
    toggled?: boolean,
    className?: string,
    onClick?: () => unknown
    onClickAnimation?: boolean
    asText?: boolean
}

export function Btn({ icon, label, tooltip, toggled, onClick, onClickAnimation, asText, ...rest }: BtnProps) {
    const [working, setWorking] = useState(false)
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
        },
        ...rest,
        ...asText ? { role: 'button', style: { cursor: 'pointer', ...rest.style } } : undefined,
        className: [rest.className, toggled && 'toggled', working && 'ani-working'].filter(Boolean).join(' '),
    }, icon && hIcon(icon), h('span', { className: 'label' }, label) ) // don't use <label> as VoiceOver will get redundant
}

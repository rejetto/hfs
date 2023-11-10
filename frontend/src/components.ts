// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getHFS, hfsEvent, hIcon } from './misc'
import {
    ButtonHTMLAttributes, ChangeEvent, createElement as h, CSSProperties, FC, forwardRef, Fragment,
    HTMLAttributes, InputHTMLAttributes, isValidElement, MouseEventHandler, ReactNode, SelectHTMLAttributes, useMemo
} from 'react'

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
            ...center && { alignItems: 'center', justifyContent: 'center' },
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

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
    value: string, // just string for the time being
    onChange?: (v: string) => void,
    options: { label: string, value: string }[]
}
export function Select({ onChange, value, options, ...props }: SelectProps) {
    return h('select', {
        onChange: ev =>
            onChange?.((ev.target as any).value),
        value,
        ...props,
    }, options.map(({ value, label }) => h('option', { key: value, value }, label)))
}

export function Html({ code, ...rest }: { code:string } & HTMLAttributes<any>) {
    return !code ? null : h('span', { ...rest, ref(x) {
        if (x)
            x.replaceChildren(document.createRange().createContextualFragment(code))
    } })
}

export function CustomCode({ name, props, ifEmpty }: { name: string, props?: any, ifEmpty?: FC }) {
    const children = useMemo(() => {
        const ret = hfsEvent(name, props)
            .filter(x => x === 0 || x)
            .map((x, key) => isValidElement(x) ? h(Fragment, { key }, x)
                : typeof x === 'string' ? h(Html, { key, code: x })
                    : h('span', { key }, x))
        const html = getHFS().customHtml?.[name]
        if (html?.trim?.())
            ret.push(h(Html, { key: 'x', code: html }))
        return ret
    }, [name, ...props ? Object.values(props) : []])
    return children.length || !ifEmpty ? h(Fragment, {}, children) : h(ifEmpty)
}

interface IconBtnOptions extends ButtonHTMLAttributes<any> { small?: boolean, style?: any }
export function iconBtn(icon: string, onClick: MouseEventHandler, { small=true, style={}, ...props }: IconBtnOptions={}) {
    return h('button', {
            onClick,
            ...props,
            ...small && {
                style: { padding: '.1em', width: 35, height: 30, ...style }
            }
        },
        icon.length > 1 ? hIcon(icon) : icon
    )
}

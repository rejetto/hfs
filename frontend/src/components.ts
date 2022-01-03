import { hIcon } from './misc'
import { createElement as h, ReactNode } from 'react'

export function Spinner() {
    return hIcon('spinner', { className:'spinner' })
}

export function Flex({ gap='1em', vert=false, children=null }) {
    return h('div', {
        style: {
            display: 'flex',
            gap,
            flexDirection: vert ? 'column' : undefined,
        }
    }, children)
}

export function FlexV(props:any) {
    return h(Flex, { vert:true, ...props })
}

interface CheckboxOptions { children?:ReactNode, value:any, onChange?:(v:boolean)=>void }
export function Checkbox({ onChange, value, children, ...props }:CheckboxOptions) {
    return h('label', {},
        h('input',{
            type:'checkbox',
            onChange: ev => onChange?.(Boolean(ev.target.checked)),
            checked: Boolean(value),
            value: 1,
            ...props
        }),
        children
    )
}

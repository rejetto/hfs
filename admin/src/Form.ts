import { createElement as h, isValidElement, ReactElement, useEffect, useState } from 'react'
import { Box, Button, FormControlLabel, Grid, MenuItem, Switch, TextField } from '@mui/material'
import { Dict } from './misc'
import { Save } from '@mui/icons-material'
import _ from 'lodash'

interface FieldDescriptor { k:string, comp?: any, label?: string, [extraProp:string]:any }

interface FormProps {
    fields: (FieldDescriptor | ReactElement | null | undefined | false)[]
    defaults?: (f:FieldDescriptor) => Dict | void
    values: Dict
    set: (v: any, field: FieldDescriptor) => void
    save?: Dict
    sticky?: boolean
    addToBar?: ReactElement[]
    [rest:string]: any,
}
export function Form({ fields, values, set, defaults, save, sticky, addToBar=[], ...rest }: FormProps) {
    return h(Box, rest,
        save && h(Box, {
            display: 'flex',
            gap: 2,
            sx: Object.assign({ mb: 4 }, sticky && { zIndex: 2, backgroundColor: 'background.paper', position: 'sticky', top: 0 })
        },
            h(Button, {
                variant: 'contained',
                startIcon: h(Save),
                ...save,
            }, 'Save'),
            ...addToBar,
        ),
        h(Grid, { container:true, rowSpacing:3, columnSpacing:1 },
            fields.map(row => {
                if (!row || isValidElement(row))
                    return row
                let field = row
                const { k } = field
                field = {
                    value: values?.[k],
                    onChange(v:any) { set(v, field) },
                    ...field,
                }
                if (!field.label)
                    field.label = _.capitalize(k.replaceAll('_', ' '))
                Object.assign(field, defaults?.(field))
                const { xs=12, sm, md, lg, xl, comp=StringField, ...rest } = field
                return h(Grid, { key: k, item: true, xs, sm, md, lg, xl },
                    h(comp, rest) )
            })
        )
    )
}

export interface FieldProps<T> {
    label?: string
    value?: T
    onChange: (v: T, more: { was?: T, event: any, [rest: string]: any }) => void
    [rest: string]: any
}

export type Field<T> = (props:FieldProps<T>) => ReactElement

export function StringField({ value, onChange, ...props }: FieldProps<string>) {
    const [state, setState] = useState(() => value ?? '')
    useEffect(() => setState(() => value ?? ''),
        [value])
    return h(TextField, {
        fullWidth: true,
        ...props,
        value: state,
        InputLabelProps: state ? { shrink: true } : undefined,
        onChange(event) {
            setState(event.target.value)
        },
        onKeyDown(ev) {
            if (ev.key === 'Enter')
                go(ev)
        },
        onBlur: go
    })

    function go(event: any) {
        if (state !== value)
            onChange(state, {
                was: value,
                event,
                cancel() {
                    setState(value ?? '')
                }
            })
    }
}

export function DisplayField({ map, value, empty='-', ...props }: any) {
    if (map)
        value = map(value)
    if (empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

interface SelectPair<T> { label: string, value:T }
export function SelectField<T>({ value, onChange, options, ...props }: FieldProps<T> & { options:SelectPair<T>[] }) {
    return h(TextField, { // using TextField because Select is not display label correctly
        ...props,
        select: true,
        fullWidth: true,
        value: value === undefined ? '' : JSON.stringify(value),
        children: options.map((o,i) => {
            const obj = o && typeof o === 'object'
            const value = obj && 'value' in o ? o.value : o
            const label = obj && 'label' in o ? o.label : o
            return h(MenuItem, { key: i, value: JSON.stringify(value), children: label })
        }),
        onChange(event) {
            try {
                onChange(JSON.parse(event.target.value as string) as T, { was: value, event })
            }
            catch {}
        }
    })
}

export function NumberField({ value, onChange, ...props }: FieldProps<number | null>) {
    // @ts-ignore
    return h(StringField, {
        type: 'number',
        value: typeof value === 'number' ? String(value) : '',
        onChange(v, { was, ...rest }) {
            onChange(v ? Number(v) : null, { ...rest, was:was ? Number(was) : null })
        },
        ...props,
    })
}

export function BoolField({ label, value, onChange, ...props }: FieldProps<boolean>) {
    const [state, setState] = useState(() => value ?? false)
    useEffect(() => setState(() => value ?? false),
        [value])
    const control = h(Switch, {
        checked: state,
        ...props,
        onChange(event) {
            onChange(event.target.checked, { event, was: value })
        }
    })
    return label ? h(FormControlLabel, { label, control, labelPlacement: 'top' })
        : control
}

export function ServerPort({ label, value, onChange }: FieldProps<number | null>) {
    return h(Box, { display:'flex' },
        h(SelectField as Field<number>, {
            sx: { flexGrow: 1 },
            label,
            value: Math.min(1, value || 0),
            options: [
                { label: 'off', value: -1 },
                { label: 'automatic port', value: 0 },
                { label: 'choose port', value: 1 },
            ],
            onChange,
        }),
        value! > 0 && h(NumberField, { fullWidth: false, value, onChange }),
    )
}

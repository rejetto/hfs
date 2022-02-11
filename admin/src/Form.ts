import { createElement as h, isValidElement, ReactElement, useEffect, useState } from 'react'
import {
    Box,
    Button,
    FormControl,
    FormControlLabel,
    FormLabel,
    Grid,
    MenuItem, Radio,
    RadioGroup,
    Switch,
    TextField
} from '@mui/material'
import { Dict } from './misc'
import { Save } from '@mui/icons-material'
import _ from 'lodash'

interface FieldDescriptor { k:string, comp?: any, label?: string | ReactElement, [extraProp:string]:any }

interface FormProps {
    fields: (FieldDescriptor | ReactElement | null | undefined | false)[]
    defaults?: (f:FieldDescriptor) => Dict | void
    values: Dict
    set: (v: any, field: FieldDescriptor) => void
    save?: Dict
    sticky?: boolean
    addToBar?: ReactElement[]
    barSx?: Dict
    [rest:string]: any,
}
export function Form({ fields, values, set, defaults, save, sticky, addToBar=[], barSx, ...rest }: FormProps) {
    return h('form', {
        onSubmit(ev) {
            ev.preventDefault()
        },
        onKeyDown(ev) {
            if (!save?.disabled && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter')
                save?.onClick?.()
        }
    },
        h(Box, rest,
            save && h(Box, {
                display: 'flex',
                gap: 2,
                alignItems: 'center',
                sx: Object.assign({ mb: 3, width: 'fit-content' },
                    sticky && { zIndex: 2, backgroundColor: 'background.paper', position: 'sticky', top: 0 },
                    barSx)
            },
                h(Button, {
                    variant: 'contained',
                    startIcon: h(Save),
                    ...save,
                }, 'Save'),
                ...addToBar,
            ),
            h(Grid, { container:true, rowSpacing:3, columnSpacing:1 },
                fields.map((row, idx) => {
                    if (!row)
                        return null
                    if (isValidElement(row))
                        return h(Grid, { key: idx, item: true, xs: 12 }, row)
                    let field = row
                    const { k } = field
                    if (k) {
                        field = {
                            value: values?.[k],
                            onChange(v:any) { set(v, field) },
                            ...field,
                        }
                        if (field.label === undefined)
                            field.label = _.capitalize(k.replaceAll('_', ' '))
                        Object.assign(field, defaults?.(field))
                    }
                    const { xs=12, sm, md, lg, xl, comp=StringField, ...rest } = field
                    return h(Grid, { key: k, item: true, xs, sm, md, lg, xl },
                        isValidElement(comp) ? comp : h(comp, rest) )
                })
            )
        )
    )
}

export interface FieldProps<T> {
    label?: string | ReactElement
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
export function SelectField<T>({ value, onChange, options, multiple, ...props }: FieldProps<T> & { options:SelectPair<T>[] }) {
    return h(TextField, { // using TextField because Select is not displaying label correctly
        ...props,
        select: true,
        fullWidth: true,
        disabled: !options?.length || props.disabled,
        SelectProps: multiple && { multiple: true },
        value: multiple ? (!Array.isArray(value) ? [] : value.map(x => JSON.stringify(x)))
            : value === undefined ? '' : JSON.stringify(value),
        children: options.map((o,i) => {
            const obj = o && typeof o === 'object'
            const value = obj && 'value' in o ? o.value : o
            const label = obj && 'label' in o ? o.label : o
            return h(MenuItem, { key: i, value: JSON.stringify(value), children: label })
        }),
        onChange(event) {
            try {
                let newVal: any = event.target.value
                newVal = multiple && Array.isArray(newVal) ? newVal.map(x => JSON.parse(x)) : JSON.parse(newVal) as T
                onChange(newVal, { was: value, event })
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

export function RadioField<T>({ label, options, value, onChange }: FieldProps<T> & { options:SelectPair<T>[] }) {
    return h(FormControl, {},
        label && h(FormLabel, {}, label),
        h(RadioGroup, {
            row: true,
            name: '',
            value: JSON.stringify(value),
            onChange(event, v){
                onChange(JSON.parse(v), { was: value, event })
            }
        },
            options.map(({ value, label }, idx) =>
                h(FormControlLabel, { key: idx, value, control: h(Radio), label }) )
        )
    )
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

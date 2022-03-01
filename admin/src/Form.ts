import { createElement as h, Fragment, isValidElement, ReactElement, useEffect, useState } from 'react'
import {
    Box,
    Button,
    FormControl,
    FormControlLabel, FormHelperText,
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

// it seems necessary to cast (Multi)SelectField sometimes
export type FieldComponent<T> = (props:FieldProps<T>) => ReactElement

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
    toField?: (v: any) => T,
    fromField?: (v: T) => any
    [rest: string]: any
}

export type Field<T> = (props:FieldProps<T>) => ReactElement

export function StringField({ value, onChange, fromField=_.identity, toField=_.identity, ...props }: FieldProps<string>) {
    if (fromField === JSON.parse)
        fromField = v => v ? JSON.parse(v) : undefined
    const [state, setState] = useState(() => toField(value) ?? '')
    const [err, setErr] = useState('')
    if (err) {
        props.error = true
        props.helperText = h(Fragment, {}, err, props.helperText && h('br'), props.helperText ) // keep existing helperText, if any
    }

    useEffect(() => {
        setState(() => toField(value) ?? '')
        setErr('')
    }, [value])
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
        let newV
        try { // catch parsing exceptions
            newV = fromField(state)
        }
        catch (e) {
            return setErr(String(e))
        }
        if (newV !== value)
            onChange(newV, {
                was: value,
                event,
                cancel() {
                    setState(value ?? '')
                }
            })
    }
}

export function DisplayField({ value, empty='-', ...props }: any) {
    if (!props.toField && empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

interface SelectPair<T> { label: string, value:T }
export function SelectField<T>(props: FieldProps<T> & { options:SelectPair<T>[] }) {
    const { value, onChange, options, ...rest } = props
    const jsonValue = JSON.stringify(value)
    const currentOption = options.find(x => JSON.stringify(x.value) === jsonValue)
    return h(TextField, { // using TextField because Select is not displaying label correctly
        ...rest,
        ...commonSelectProps(props),
        // avoid warning for invalid option. This can easily happen for a split-second when you keep value in a useState (or other async way) and calculate options with a useMemo (or other sync way) causing a temporary misalignment.
        value: currentOption ? jsonValue : '',
        onChange(event) {
            try {
                let newVal: any = event.target.value
                newVal = JSON.parse(newVal) as T
                onChange(newVal, { was: value, event })
            }
            catch {}
        }
    })
}

export function MultiSelectField<T>(props: FieldProps<T[]> & { options:SelectPair<T>[] }) {
    const { value, onChange, options, ...rest } = props
    return h(TextField, {
        ...rest,
        ...commonSelectProps(props),
        SelectProps: { multiple: true },
        value: !Array.isArray(value) ? [] : value.map(x => JSON.stringify(x)),
        onChange(event) {
            try {
                let v: any = event.target.value
                v = Array.isArray(v) ? v.map(x => JSON.parse(x)) : []
                onChange(v as T[], { was: value, event })
            }
            catch {}
        }
    })
}

function commonSelectProps<T>(props: { disabled?: boolean, options:SelectPair<T>[] }) {
    const { options, disabled } = props
    return {
        select: true,
        fullWidth: true,
        disabled: !options?.length || disabled,
        children: options.map((o, i) => {
            const obj = o && typeof o === 'object'
            const value = obj && 'value' in o ? o.value : o
            const label = obj && 'label' in o ? o.label : o
            return h(MenuItem, { key: i, value: JSON.stringify(value), children: label })
        })
    }
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

export function BoolField({ label='', value, onChange, helperText, fromField=_.identity, toField=_.identity, ...props }: FieldProps<boolean>) {
    const setter = () => toField(value) ?? false
    const [state, setState] = useState(setter)
    useEffect(() => setState(setter),
        [value])
    const control = h(Switch, {
        checked: state,
        ...props,
        onChange(event) {
            onChange(fromField(event.target.checked), { event, was: value })
        }
    })
    return h(Box, { ml: 1 },
        h(FormControlLabel, { label, control, labelPlacement: 'end' }),
        helperText && h(FormHelperText,{},helperText)
    )
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

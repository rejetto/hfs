import { createElement as h, useEffect, useState } from 'react'
import { StringField } from './StringField'
import { FieldProps } from './Form'
import {
    Box,
    Checkbox,
    FormControl,
    FormControlLabel,
    FormGroup,
    FormHelperText,
    FormLabel,
    Switch
} from '@mui/material'

export function DisplayField({ value, empty='-', ...props }: any) {
    if (!props.toField && empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

export function NumberField({ value, onChange, getApi, required, min, max, step, ...props }: FieldProps<number | null>) {
    getApi?.({
        getError() {
            return value == null ? (required ? "required" : false)
                : (value < min ? "too low" : value > max ? "too high" : false)
        }
    })
    return h(StringField, {
        type: 'number',
        value: value == null ? '' : String(value),
        onChange(v, { was, ...rest }) {
            onChange(!v ? null : Number(v), {
                ...rest,
                was: was ? Number(was) : null,
            })
        },
        inputProps: { min, max, step, },
        ...props,
    })
}

export function BoolField({ label='', value, onChange, getApi, helperText, error,
                              type, // avoid passing this by accident, as it disrupts the control
                              ...props }: FieldProps<boolean>) {
    const setter = () => value ?? false
    const [state, setState] = useState(setter)
    useEffect(() => setState(setter),
        [value]) //eslint-disable-line
    const control = h(Switch, {
        checked: state,
        ...props,
        onChange(event) {
            onChange(event.target.checked, { event, was: value })
        }
    })
    return h(Box, { ml: 1, mt: 1, sx: error ? { color: 'error.main', outlineOffset: 6, outline: '1px solid' } : undefined },
        h(FormControlLabel, { label, control, labelPlacement: 'end' }),
        helperText && h(FormHelperText, { error }, helperText)
    )
}

export function CheckboxesField({ label, options, value, onChange, columns, columnWidth }: FieldProps<string[]> & { options: string[] }) {
    const doCols = columns > 1 || Boolean(columnWidth)
    return h(FormControl, { fullWidth: doCols },
        label && h(FormLabel, {}, label),
        h(FormGroup, { sx: { ...doCols && { columns, columnWidth, '&, & label': { display: 'block' } } } },
            options.map(o => {
                const checked = value?.includes(o)
                return h(FormControlLabel, {
                    key: o,
                    checked,
                    control: h(Checkbox),
                    label: o,
                    onClick(event) {
                        const newValue = checked ? value!.filter(x => x !== o) : [...value||[], o]
                        onChange(newValue, { was: value, event })
                    }
                })
            }))
    )
}

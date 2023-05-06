// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useState } from 'react'
import { StringField } from './StringField'
import { FieldProps } from '.'
import {
    Box,
    Checkbox,
    FormControl,
    FormControlLabel,
    FormGroup,
    FormHelperText,
    FormLabel,
    InputAdornment,
    Switch
} from '@mui/material'
import _ from 'lodash'

export function DisplayField({ value, empty='-', ...props }: any) {
    if (!props.toField && empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

export function NumberField({ value, onChange, getApi, required, min, max, step, unit, ...props }: FieldProps<number | null>) {
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
        InputProps: _.merge({
            sx: { '& input': { appearance: 'textfield' } }
        }, unit && {
            sx: { pr: '6px', '& input': { pl: '.2em', textAlign: 'right' } },
            endAdornment: h(InputAdornment, {
                position: 'end',
                sx: { mt: '1.2em', ml: '5px', '& p': { fontSize: '80%' } }
            }, unit),
        }),
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
            onChange((event.target as any).checked, { event, was: value })
        }
    })
    return h(Box, { ml: 1, mt: 1, sx: error ? { color: 'error.main', outlineOffset: 6, outline: '1px solid' } : undefined },
        h(FormControlLabel, { label, control, labelPlacement: 'end', ...props.size==='small' && { sx: { '& .MuiFormControlLabel-label': { fontSize: '.9rem' } } } }),
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

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useState } from 'react'
import { StringField } from './StringField'
import { FieldProps } from '.'
import {
    Box, Checkbox, FormControl, FormControlLabel, FormGroup, FormHelperText, FormLabel, IconButton,
    InputAdornment, Switch
} from '@mui/material'
import { Cancel } from '@mui/icons-material'
import _ from 'lodash'
import { useGetSize } from '@hfs/shared'

export function DisplayField({ value, empty='-', ...props }: any) {
    if (!props.toField && empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

export function NumberField({ value, onChange, setApi, required, min=0, max, step, unit, clearable, ...props }: FieldProps<number | null>) {
    setApi?.({
        getError() {
            return value == null ? (required ? "required" : false)
                : (value < min ? "too low" : value > max ? "too high" : false)
        }
    })
    const size = useGetSize()
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
            sx: { '& input': { appearance: 'textfield' } },
            startAdornment: (clearable ?? props.placeholder) && size.w! > 100 && (value || value === 0) && h(InputAdornment, {
                position: 'start',
            }, h(IconButton, {
                size: 'small',
                edge: 'start',
                sx: { ml: -1, opacity: .5 },
                'aria-label': "clear",
                onClick(event){ onChange(null, { was: value, event }) }
            }, h(Cancel))),
        }, unit && {
            sx: { pr: '6px', '& input': { pl: '.2em', textAlign: 'right' } },
            endAdornment: h(InputAdornment, {
                position: 'end',
                sx: { mt: '1.2em', ml: '5px', '& p': { fontSize: '80%', '.Mui-focused &': { color: 'text.primary' } } }
            }, unit),
        }),
        ...props,
        fieldRef: size.refToPass,
    })
}

export function BoolField({ label='', value, onChange, setApi, helperText, error, Control=Switch,
                              type, // avoid passing this by accident, as it disrupts the control
                              ...props }: FieldProps<boolean>) {
    const setter = () => value ?? false
    const [state, setState] = useState(setter)
    useEffect(() => setState(setter),
        [value]) //eslint-disable-line
    const control = h(Control, {
        checked: state,
        ...props,
        onChange(event) {
            onChange((event.target as any).checked, { event, was: value })
        }
    })
    return h(Box, { ml: 1, sx: error ? { color: 'error.main', outlineOffset: 6, outline: '1px solid' } : undefined },
        h(FormControlLabel, { label, control, labelPlacement: 'end', sx: { mr: 0, ...props.size==='small' && { '& .MuiFormControlLabel-label': { fontSize: '.9rem' } } } }),
        helperText && h(FormHelperText, { sx: { mt: 0 }, error }, helperText)
    )
}

export function CheckboxField(props: FieldProps<boolean>) {
    return h(BoolField, { Control: Checkbox, ...props })
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

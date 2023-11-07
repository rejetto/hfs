// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode } from 'react'
import { FieldProps } from '.'
import { FormControl, FormControlLabel, FormLabel, IconButton, InputAdornment, MenuItem, Radio, RadioGroup,
    StandardTextFieldProps, TextField, Tooltip
} from '@mui/material'
import { SxProps } from '@mui/system'
import { Clear } from '@mui/icons-material'

type SelectOptions<T> = { [label:string]:T } | SelectOption<T>[]
type SelectOption<T> = SelectPair<T> | (T extends string | number ? T : never)
interface SelectPair<T> { label: string, value:T }

export function SelectField<T>(props: FieldProps<T> & CommonSelectProps<T>) {
    const { value, onChange, setApi, options, sx, ...rest } = props
    return h(TextField, { // using TextField because Select is not displaying label correctly
        ...commonSelectProps(props),
        ...rest,
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

export function MultiSelectField<T>(props: FieldProps<T[]> & CommonSelectProps<T>) {
    const { value, onChange, setApi, options, sx, clearable, clearValue, ...rest } = props
    return h(TextField, {
        ...commonSelectProps({ clearValue: [], ...props }),
        ...rest,
        SelectProps: { multiple: true },
        sx: { ...rest.sx, '& div[role=button]': { whiteSpace: 'unset' } },
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

type HelperCommon<T> = Partial<Omit<StandardTextFieldProps, 'label' | 'value' | 'onChange'>> & Pick<FieldProps<T>, 'value' | 'onChange' | 'label'>
interface CommonSelectProps<T> extends HelperCommon<T> {
    sx?: SxProps
    disabled?: boolean
    clearable?: boolean
    clearValue?: T | []
    options: SelectOptions<T>
    start?: ReactNode
    end?: ReactNode
}
function commonSelectProps<T>(props: CommonSelectProps<T>) {
    const { options, disabled, start, end, clearable, clearValue, value } = props
    const normalizedOptions = !Array.isArray(options) ? Object.entries(options).map(([label,value]) => ({ value, label }))
        : options.map(o => typeof o === 'string' || typeof o === 'number' ? { value: o, label: String(o) } : o as SelectPair<T>)
    const jsonValue = JSON.stringify(value)
    const currentOption = normalizedOptions.find(x => JSON.stringify(x.value) === jsonValue)
    const showClear = clearable && (Array.isArray(value) ? value.length > 0 : value)
    return {
        select: true,
        fullWidth: true,
        sx: props.label ? props.sx : Object.assign({ '& .MuiInputBase-input': { pt: 1 } }, props.sx),
        // avoid warning for invalid option. This can easily happen for a split-second when you keep value in a useState (or other async way) and calculate options with a useMemo (or other sync way) causing a temporary misalignment.
        value: currentOption ? jsonValue : '',
        disabled: !normalizedOptions?.length || disabled,
        InputProps: {
            startAdornment: (start || showClear) && h(InputAdornment, { position: 'start' },
                showClear && h(Tooltip, { title: "Clear", children: h(IconButton, {
                    onClick(event) {
                        props.onChange(clearValue as any, { was: value, event })
                    }
                }, h(Clear)) }),
                start),
            endAdornment: end && h(InputAdornment, { position: 'end' }, end),
            ...props.InputProps,
        },
        children: normalizedOptions.map((o, i) => h(MenuItem, {
            key: i,
            value: JSON.stringify(o?.value),
            children: h(Fragment, { key: i }, o?.label) // without this fragment/key, a label as h(span) will produce warnings
        }))
    }
}

export function RadioField<T>({ label, options, value, onChange }: FieldProps<T> & { options:SelectPair<T>[] }) {
    return h(FormControl, {},
        label && h(FormLabel, {}, label),
        h(RadioGroup, {
            row: true,
            name: '',
            value: JSON.stringify(value),
            onChange(event, v) {
                onChange(JSON.parse(v), { was: value, event })
            },
            children: options.map(({ value, label }, idx) =>
                h(FormControlLabel, { key: idx, value, control: h(Radio), label }))
        })
    )
}


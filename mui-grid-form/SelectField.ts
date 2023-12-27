// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode, useMemo } from 'react'
import { FieldProps } from '.'
import {
    Autocomplete, Chip, FormControl, FormControlLabel, FormLabel, IconButton, InputAdornment, MenuItem, Radio,
    RadioGroup, StandardTextFieldProps, TextField, Tooltip
} from '@mui/material'
import { SxProps } from '@mui/system'
import { Clear } from '@mui/icons-material'

type SelectOptions<T> = { [label:string]: T } | SelectOption<T>[]
type SelectOption<T> = SelectPair<T> | (T extends string | number ? T : never)
interface SelectPair<T> { label: string, value: T }

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

export function MultiSelectField<T>({ renderOption, ...props }: FieldProps<T[]> & CommonSelectProps<T> & { renderOption?: (option: SelectPair<T>) => ReactNode }) {
    const { value, onChange, setApi, options, sx, clearable, clearValue, placeholder, autocompleteProps, ...rest } = props
    const { select, InputProps, ...common } = commonSelectProps({ clearValue: [], ...props, clearable: false })
    const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
    const valueAsOptions = useMemo(() => !Array.isArray(value) ? []
            : value.map(x => normalizedOptions.find(o => o.value === x) || { value: x, label: String(x) }),
        [value, normalizedOptions])
    return h(Autocomplete<SelectPair<T>, true>, {
        multiple: true,
        options: normalizedOptions,
        filterSelectedOptions: true,
        onChange: (event, sel) => onChange(sel.map(x => x.value) as T[], { was: value, event }),
        isOptionEqualToValue: (option, val) => option.value === val.value,
        getOptionLabel: x => x.label,
        renderOption: (props, x) => h('span', props, renderOption?.(x) ?? x.label),
        ...common,
        ...autocompleteProps,
        value: valueAsOptions,
        renderInput: params => h(TextField, {
            ...rest,
            placeholder: valueAsOptions.length ? undefined : placeholder, // TextField's own logic doesn't know about the main field not being empty
            SelectProps: { multiple: true },
            sx: { ...rest.sx, '& div[role=button]': { whiteSpace: 'unset' } },
            ...params,
        }),
        renderTags: (tagValue, getTagProps) =>
            tagValue.map((option, index) =>
                h(Chip, { label: renderOption?.(option) ?? option.label, ...getTagProps({ index }) })),
        sx: {
            '.MuiAutocomplete-tag': { height: 24 }, // too tall, otherwise
            '.MuiAutocomplete-inputRoot': { pt: '21px' }, // some extra margin from label
            'input[type][type]': { p: '4px' },
            '.MuiChip-deleteIcon[class]': { position: 'absolute', right: '-0.6em', opacity: 0, color: 'text.primary', transition: 'all .2s' },
            '.MuiChip-root:hover .MuiChip-deleteIcon': { opacity: 1 },
            ...sx,
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
    const normalizedOptions = normalizeOptions(options)
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

function normalizeOptions<T>(options: SelectOptions<T>) {
    return !Array.isArray(options) ? Object.entries(options).map(([label,value]) => ({ value, label }))
        : options.map(o => typeof o === 'string' || typeof o === 'number' ? { value: o, label: String(o) } : o as SelectPair<T>)
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


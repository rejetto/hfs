// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode, useId, useMemo } from 'react'
import { FieldProps } from '.'
import { FormControl, FormControlLabel, FormLabel, MenuItem, Radio, InputLabel, Select,
    ListItemText, Checkbox, FilledInput, RadioGroup, TextField, FormHelperText, Button } from '@mui/material'
import { SxProps } from '@mui/system'

type SelectOptions<T> = { [label:string]: T } | SelectOption<T>[]
type SelectOption<T> = SelectPair<T> | (T extends string | number ? T : never)
interface SelectPair<T> { label: string, value: T }

export function SelectField<T>(props: FieldProps<T> & CommonSelectProps<T>) {
    const { value, onChange, setApi, options, sx, disabled, ...rest } = props
    const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
    const jsonValue = JSON.stringify(value)
    const currentOption = normalizedOptions.find(x => JSON.stringify(x.value) === jsonValue)
    return h(TextField, { // using TextField because Select is not displaying label correctly
        select: true,
        hiddenLabel: !props.label,
        // avoid warning for invalid option. This can easily happen for a split-second when you keep value in a useState (or other async way) and calculate options with a useMemo (or other sync way) causing a temporary misalignment.
        value: currentOption ? jsonValue : '',
        disabled: !normalizedOptions?.length || disabled,
        children: normalizedOptions.map((o, i) => h(MenuItem, {
            key: i,
            value: JSON.stringify(o?.value),
            children: h(Fragment, { key: i }, o?.label) // without this fragment/key, a label as h(span) will produce warnings
        })),
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

type MultiSelectFieldProps<T> = FieldProps<T[]> & CommonSelectProps<T> & {
    renderOption?: (option: SelectPair<T>) => ReactNode
    clearable?: boolean
}
export function MultiSelectField<T>({ renderOption, ...props }: MultiSelectFieldProps<T>) {
    const { value, onChange, setApi, options, placeholder, helperText, label, valueSeparator = ', ', clearable=true, ...rest } = props
    const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
    const valueAsOptions = useMemo(() => !Array.isArray(value) ? []
            : value.map(x => normalizedOptions.find(o => o.value === x) || { value: x, label: String(x) }),
        [value, normalizedOptions])
    const valueAsJsons = useMemo(() => value?.map(x => JSON.stringify(x)) || [], [value])
    const labelId = useId()
    const helperId = useId()
    const showClear = valueAsOptions.length > 0
    return h(FormControl, { fullWidth: true, variant: 'filled', hiddenLabel: !label },
        h(InputLabel, {
            id: labelId,
            sx: { '&.Mui-focused': { color: 'inherit' } }, // override style rule giving this a dim contrast and hard to read
        }, label),
        h(Select<string[]>, {
            ...commonSelectProps(props),
            multiple: true,
            value: valueAsJsons,
            onChange: event => {
                let { value: v } = event.target
                if (!Array.isArray(v)) { debugger; return }
                v = v.map(x => x && JSON.parse(x)) // x can be undefined because of the clear-button
                onChange(v as any, { was: value, event })
            },
            input: h(FilledInput, {
                placeholder,
                hiddenLabel: !label,
                'aria-describedby': helperId,
            }),
            renderValue: () => h('div', {
                'aria-label': label + ': ' + valueAsOptions.map(x => x.label),
                style: { overflow: "hidden", display: "flex", flexWrap: "wrap", gap: ".5em" },
                children: valueAsOptions.map((x, i) => h('span', { key: i }, renderOption?.(x) ?? x.label, i < valueAsOptions.length - 1 && valueSeparator)),
            }),
            ...rest,
        },
            !normalizedOptions.length && h(ListItemText, { sx: { fontStyle: 'italic', ml: 1 }, onClickCapture(ev) { ev.stopPropagation() } }, "No options available"),
            normalizedOptions.length > 1 && h(Button, {
                ref: x => x && Object.assign(x, { role: undefined }), // cancel the role=option on this
                onClickCapture(event) {
                    event.stopPropagation()
                    onChange(showClear ? [] : normalizedOptions.map(x => x.value), { was: value, event })
                },
            }, showClear ? "Unselect all" : "Select all"),
            ...normalizedOptions.map(o => h(MenuItem, { value: JSON.stringify(o?.value) }, // encode, as this supports only string|number
                h(Checkbox, { checked: value?.includes(o.value) || false }),
                h(ListItemText, { primary: renderOption?.(o) ?? o.label })
            )),
        ),
        h(FormHelperText, { id: helperId, error: props.error }, helperText),
    )
}

type HelperCommon<T> = Pick<FieldProps<T>, 'value' | 'onChange' | 'label'>
interface CommonSelectProps<T> extends HelperCommon<T> {
    sx?: SxProps
    disabled?: boolean
    options: SelectOptions<T>
}
function commonSelectProps<T>(props: CommonSelectProps<T>) {
    return {
        fullWidth: true,
        sx: Object.assign({
            '& .MuiInputBase-inputHiddenLabel': {
                py: 1,
                '& .MuiInputAdornment-root': { ml: -1 },
            }
        }, props.sx),
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


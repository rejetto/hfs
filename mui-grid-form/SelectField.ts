// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode, useId, useMemo } from 'react'
import { FieldProps } from '.'
import {
    FormControl, FormControlLabel, FormLabel, MenuItem, Radio, InputLabel, Select, LinearProgress,
    ListItemText, Checkbox, FilledInput, RadioGroup, TextField, FormHelperText, Button, Box
} from '@mui/material'
import { SxProps } from '@mui/system'
import { useIsMobile } from '@hfs/shared'

type SelectOptions<T> = { [label:string]: T } | SelectOption<T>[]
type SelectOption<T> = SelectOptionNormalized<T> | (T extends string | number ? T : never)
interface SelectOptionNormalized<T> { label?: string, value: T, disabled?: boolean }

export function SelectField<T>(props: FieldProps<T> & CommonSelectProps<T>) {
    const { value, onChange, setApi, options, sx, disabled, afterList, ...rest } = props
    const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
    const jsonValue = JSON.stringify(value)
    const currentOption = normalizedOptions?.find(x => JSON.stringify(x.value) === jsonValue)
    return h(TextField, { // using TextField because Select is not displaying label correctly
        select: true,
        hiddenLabel: !props.label,
        // avoid warning for invalid option. This can easily happen for a split-second when you keep value in a useState (or other async way) and calculate options with a useMemo (or other sync way) causing a temporary misalignment.
        value: currentOption ? jsonValue : '',
        disabled: normalizedOptions?.length === 0 || disabled,
        children: !normalizedOptions ? h(LinearProgress) : [
            ...normalizedOptions.map((o, i) => h(MenuItem, {
                key: i,
                value: JSON.stringify(o?.value),
                disabled: o?.disabled,
                children: h(Fragment, { key: i }, o?.label ?? String(o?.value)) // without this fragment/key, a label as h(span) will produce warnings
            })),
            h('div', { key: -1 }, afterList),
        ],
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
    renderOption?: (option: SelectOptionNormalized<T>) => ReactNode
    clearable?: boolean
}
export function MultiSelectField<T>({ renderOption, ...props }: MultiSelectFieldProps<T>) {
    const { value, onChange, setApi, options, placeholder, helperText, label, valueSeparator = ', ', clearable=true, afterList, ...rest } = props
    const normalizedOptions = useMemo(() => normalizeOptions(options), [options])
    const valueAsOptions = useMemo(() => !Array.isArray(value) ? []
            : value.map(x => normalizedOptions?.find(o => o.value === x) || { value: x, label: String(x) }),
        [value, normalizedOptions])
    const valueAsJsons = useMemo(() => value?.map(x => JSON.stringify(x)) || [], [value])
    const isMobile = useIsMobile()
    const labelId = useId()
    const helperId = useId()
    const isEmpty = !valueAsOptions.length
    renderOption ??= x => x.label ?? String(x.value)
    return h(FormControl, { fullWidth: true, variant: 'filled', hiddenLabel: !label },
        h(InputLabel, {
            id: labelId,
            sx: { '&.Mui-focused': { color: 'inherit' } }, // override style rule giving this a dim contrast and hard to read
        }, label),
        h(Select<string[]>, {
            ...commonSelectProps(props),
            multiple: true,
            displayEmpty: true,
            value: valueAsJsons,
            onChange: event => {
                let { value: v } = event.target
                if (!Array.isArray(v)) { debugger; return }
                v = v.map(x => x && JSON.parse(x)) // x can be undefined because of the clear-button
                onChange(v as any, { was: value, event })
            },
            sx: { '& .MuiSelect-select': { maxHeight: '15em', overflowY: 'auto' } },
            input: h(FilledInput, {
                hiddenLabel: !label,
                'aria-describedby': helperId,
            }),
            renderValue: () => h('div', {
                'aria-label': label + ': ' + valueAsOptions.map(x => x.label ?? String(x.value)),
                style: { overflow: "hidden", display: "flex", flexWrap: "wrap", gap: ".5em" },
                children: isEmpty ? h(Box, { position: 'relative', top: '.3em', fontSize: 'small', fontStyle: 'italic', color: 'text.secondary' }, placeholder)
                    : valueAsOptions.map((x, i) => h('span', { key: i }, renderOption!(x), i < valueAsOptions.length - 1 && valueSeparator)),
            }),
            ...rest,
        },
            !normalizedOptions ? h(LinearProgress)
                : (!normalizedOptions.length && h(ListItemText, {
                    sx: { fontStyle: 'italic', ml: 1 },
                    onClickCapture(ev) { ev.stopPropagation() }
                }, "No options available")),
            !isMobile && normalizedOptions?.length! > 20 && h(Box, {
                sx: { float: 'right' }, fontSize: 'small', width: '8em', textAlign: 'right', marginRight: '.5em'
            }, "ⓘ You can type the name"),
            normalizedOptions?.length! > 1 && h(Button, {
                size: 'small',
                sx: { ml: 1 },
                ref: x => x && Object.assign(x, { role: undefined }) && setTimeout(() => x.focus()), // cancel the role=option on this
                onClickCapture(event) {
                    event.stopPropagation()
                    onChange(isEmpty ? normalizedOptions!.map(x => x.value) : [], { was: value, event })
                },
            }, isEmpty ? "Select all" : "Unselect all"),
            ...normalizedOptions?.map(o => h(MenuItem, { value: JSON.stringify(o?.value) }, // encode, as this supports only string|number
                h(Checkbox, { checked: value?.includes(o.value) || false }),
                h(ListItemText, { primary: renderOption!(o) })
            )) || [],
            afterList,
        ),
        h(FormHelperText, { id: helperId, error: props.error }, helperText),
    )
}

type HelperCommon<T> = Pick<FieldProps<T>, 'value' | 'onChange' | 'label'>
interface CommonSelectProps<T> extends HelperCommon<T> {
    sx?: SxProps
    disabled?: boolean
    // pass options undefined to display a loading indicator in place of the options
    options?: SelectOptions<T>
    afterList?: ReactNode
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

function normalizeOptions<T>(options?: SelectOptions<T>) {
    return !options ? undefined : !Array.isArray(options) ? Object.entries(options).map(([label,value]) => ({ value, label } as SelectOptionNormalized<T>))
        : options.map(o => typeof o === 'string' || typeof o === 'number' ? { value: o } : o as SelectOptionNormalized<T>)
}

export function RadioField<T>({ label, options, value, onChange }: FieldProps<T> & { options:SelectOptionNormalized<T>[] }) {
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


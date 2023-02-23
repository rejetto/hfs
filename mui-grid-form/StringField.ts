// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { FieldProps } from '.'
import { Autocomplete, InputAdornment, TextField } from '@mui/material'

interface StringProps extends FieldProps<string> {
    typing?: boolean
    onTyping?: (v: string) => boolean
    min?: number
    max?: number
    required?: boolean
    start?: ReactNode
    end?: ReactNode
}
export function StringField({ value, onChange, min, max, required, getApi, typing, start, end, onTyping, suggestions, ...props }: StringProps) {
    const normalized = value ?? ''
    getApi?.({
        getError() {
            return !value && required ? "required"
                : value?.length! < min! ? "too short"
                    : value?.length! > max! ? "too long"
                        : false
        }
    })
    const [state, setState] = useState(normalized)

    const lastChange = useRef(normalized)
    useEffect(() => {
        setState(normalized)
        lastChange.current = normalized
    }, [normalized])
    const render = (params: any) => h(TextField, {
        fullWidth: true,
        InputLabelProps: state || props.placeholder ? { shrink: true } : undefined,
        ...props,
        sx: props.label ? props.sx : Object.assign({ '& .MuiInputBase-input': { pt: 1.5 } }, props.sx),
        value: state,
        onChange(ev) {
            const val = ev.target.value
            if (onTyping?.(val) === false) return
            setState(val)
            if (typing // change state as the user is typing
                || document.activeElement !== ev.target) // autofill ongoing, don't wait onBlur event, just go
                go(ev, val)
        },
        onKeyDown(ev) {
            props.onKeyDown?.(ev)
            if (ev.key === 'Enter')
                go(ev)
        },
        onBlur(ev) {
            props.onBlur?.(ev)
            go(ev)
        },
        InputProps: {
            startAdornment: start && h(InputAdornment, { position: 'start' }, start),
            endAdornment: end && h(InputAdornment, { position: 'end' }, end),
            ...props.InputProps,
        },
        ...params,
    })
    return !suggestions ? render(null)
        : h(Autocomplete, { freeSolo: true, options: suggestions, renderInput: render })

    function go(event: any, val: string=state) {
        const newV = val.trim()
        if (newV === lastChange.current) return // don't compare to 'value' as that represents only accepted changes, while we are interested also in changes through discarded values
        lastChange.current = newV
        onChange(newV, {
            was: value,
            event,
            cancel() {
                setState(normalized)
            }
        })
    }
}


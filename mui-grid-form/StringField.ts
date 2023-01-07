import { createElement as h, useEffect, useRef, useState } from 'react'
import { FieldProps } from '.'
import { InputAdornment, TextField } from '@mui/material'

export function StringField({ value, onChange, min, max, required, getApi, typing, start, end, ...props }: FieldProps<string>) {
    const normalized = value ?? ''
    getApi?.({
        getError() {
            return !value && required ? "required"
                : value?.length! < min ? "too short"
                    : value?.length! > max ? "too long"
                        : false
        }
    })
    const [state, setState] = useState(normalized)

    const lastChange = useRef(normalized)
    useEffect(() => {
        setState(normalized)
        lastChange.current = normalized
    }, [normalized])
    return h(TextField, {
        fullWidth: true,
        InputLabelProps: state || props.placeholder ? { shrink: true } : undefined,
        ...props,
        sx: props.label ? props.sx : Object.assign({ '& .MuiInputBase-input': { pt: 1.5 } }, props.sx),
        value: state,
        onChange(ev) {
            const val = ev.target.value
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
    })

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


// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { FieldProps } from '.'
import { Autocomplete, InputAdornment, TextField } from '@mui/material'
import { StandardTextFieldProps } from '@mui/material/TextField/TextField'

interface StringFieldProps extends FieldProps<string>, Partial<Omit<StandardTextFieldProps, 'label' | 'onChange' | 'value'>> {
    typing?: boolean // change state as the user is typing
    onTyping?: (v: string) => string | false
    min?: number
    max?: number
    required?: boolean
    start?: ReactNode
    end?: ReactNode
}
export function StringField({ value, onChange, min, max, required, setApi, typing, start, end, onTyping, suggestions, ...props }: StringFieldProps) {
    const normalized = value ?? ''
    setApi?.({
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
    const valueFocusing = useRef<string | undefined>()
    const autoFillDetected = useRef(false)
    const render = (params: any) => h(TextField, {
        fullWidth: true,
        InputLabelProps: state || props.placeholder ? { shrink: true } : undefined,
        ...props,
        ...params,
        sx: props.label ? props.sx : Object.assign({ '& .MuiInputBase-input': { pt: 1.5 } }, props.sx),
        value: state,
        onChange(ev) {
            let val = ev.target.value
            if (onTyping) {
                const res = onTyping(val)
                if (res === false) return
                val = res
            }
            setState(val)
            if (typing || autoFillDetected.current || valueFocusing.current === undefined)
                go(ev, val)
        },
        onKeyDown(ev) {
            props.onKeyDown?.(ev)
            autoFillDetected.current = ev.code === undefined
            if (ev.key === 'Enter' && (ev.target as HTMLElement).ariaExpanded !== 'true') // don't act if suggestion list is expanded
                go(ev)
        },
        onFocus(ev) {
            valueFocusing.current = ev.target.value
        },
        onBlur(ev) {
            props.onBlur?.(ev)
            if (valueFocusing.current !== ev.target.value)
                go(ev)
        },
        InputProps: {
            ...props.InputProps,
            ...params?.InputProps,
            startAdornment: start && h(InputAdornment, { position: 'start' }, start, props?.InputProps?.startAdornment, params?.InputProps?.startAdornment),
            endAdornment: end && h(InputAdornment, { position: 'end' }, end, props?.InputProps?.endAdornment, params?.InputProps?.endAdornment),
        },
    })
    return !suggestions ? render(null)
        : h(Autocomplete, {
            value,
            freeSolo: true,
            options: suggestions,
            renderInput: render,
            onChange(ev, v) {
                go(ev, v as string)
            }
        })

    function go(event: any, newVal: string=state) {
        newVal = newVal?.trim()
        if (newVal === lastChange.current) return // don't compare to 'value' as that represents only accepted changes, while we are interested also in changes through discarded values
        lastChange.current = newVal
        onChange(newVal, {
            was: value,
            event,
            cancel() {
                setState(normalized)
            }
        })
    }
}


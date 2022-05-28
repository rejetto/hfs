// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    createElement as h,
    FC,
    Fragment,
    isValidElement,
    ReactElement,
    ReactNode,
    useEffect,
    useState,
    useRef,
    MutableRefObject
} from 'react'
import {
    Box, BoxProps, Button,
    Checkbox,
    FormControl,
    FormControlLabel, FormGroup, FormHelperText,
    FormLabel,
    Grid, InputAdornment,
    MenuItem, Radio,
    RadioGroup,
    Switch,
    TextField
} from '@mui/material'
import { Save } from '@mui/icons-material'
import { LoadingButton } from '@mui/lab'
import _ from 'lodash'
import { SxProps } from '@mui/system'

type Validate = (v: any, extra?: any) => string | boolean
export interface FieldDescriptor<T=any> {
    k: string
    comp?: any
    label?: ReactNode
    validate?: Validate
    toField?: (v: T) => any
    fromField?: (v: any) => T
    [extraProp: string]: any
}

// it seems necessary to cast (Multi)SelectField sometimes
export type Field<T> = FC<FieldProps<T>>

type Dict<T=any> = Record<string,T>

export interface FormProps<Values> extends Partial<BoxProps> {
    fields: (FieldDescriptor | ReactElement | null | undefined | false)[]
    defaults?: (f:FieldDescriptor) => any
    values: Values
    set: (v: any, fieldK: string) => void
    save: Partial<Parameters<typeof Button>[0]> | (()=>any)
    stickyBar?: boolean
    addToBar?: ReactNode[]
    barSx?: Dict
    onError?: (err: any) => any
    formRef?: MutableRefObject<HTMLFormElement | undefined>
    saveOnEnter?: boolean
}
enum Phase { Idle, WaitValues, Validating }
export function Form<Values extends Dict>({ fields, values, set, defaults, save, stickyBar, addToBar=[], barSx, formRef, onError, saveOnEnter, ...rest }: FormProps<Values>) {
    const mounted = useRef(false)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const [errors, setErrors] = useState<Dict<string | false>>({})
    const saveBtn = typeof save === 'function' ? { onClick: save } : save // normalize
    const [phase, setPhase] = useState(Phase.Idle)
    const submitAfterValidation = useRef(false)
    const validateUpTo = useRef('')
    useEffect(() => void(phaseChange()), [phase]) //eslint-disable-line

    const apis: Dict<FieldApi> = {}
    return h('form', {
        ref: formRef && (x => formRef.current = x ? x as HTMLFormElement : undefined),
        onSubmit(ev) {
            ev.preventDefault()
        },
        onKeyDown(ev) {
            if (!saveBtn.disabled && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter')
                pleaseSubmit()
        }
    },
        h(Box, {
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            ...rest
        },
            h(Grid, { container:true, rowSpacing:3, columnSpacing:1 },
                fields.map((row, idx) => {
                    if (!row)
                        return null
                    if (isValidElement(row))
                        return h(Grid, { key: idx, item: true, xs: 12 }, row)
                    const { k, fromField=_.identity, toField=_.identity, validate, ...field } = row
                    let error = errors[k]
                    if (error === '')
                        error = "Not valid"
                    if (k) {
                        const originalValue = values?.[k]
                        const whole = { ...row, ...field }
                        Object.assign(field, {
                            value: toField(originalValue),
                            error: Boolean(error) || undefined,
                            getApi(api) { apis[k] = api },
                            onBlur() {
                                pleaseValidate(k)
                            },
                            async onChange(v, { event }) {
                                try {
                                    v = fromField(v)
                                    if (_.isEqual(v, originalValue)) return
                                    set(v, k)
                                    if (saveOnEnter && event.key === 'Enter')
                                        pleaseSubmit()
                                    else
                                        pleaseValidate(k)
                                }
                                catch (e) {
                                    onError?.(e)
                                }
                            },
                        } as Partial<FieldProps<any>>)
                        if (error) // special rendering when we have both error and helperText. "hr" would be nice but issues a warning because contained in a <p>
                            field.helperText = field.helperText ? h(Fragment, {}, h('span', { style: { borderBottom: '1px solid' } }, error), h('br'), field.helperText)
                                : error
                        if (field.label === undefined)
                            field.label = labelFromKey(k)
                        _.defaults(field, defaults?.(whole))
                    }
                    {
                        const { xs=12, sm, md, lg, xl, comp=StringField,
                            fromField, toField, // don't propagate
                            ...rest } = field
                        return h(Grid, { key: k, item: true, xs, sm, md, lg, xl },
                            isValidElement(comp) ? comp : h(comp, rest) )
                    }
                })
            ),
            saveBtn && h(Box, {
                    display: 'flex',
                    alignItems: 'center',
                    sx: Object.assign({},
                        stickyBar && { width: 'fit-content', zIndex: 2, backgroundColor: 'background.paper', position: 'sticky', bottom: 0, p: 1, m: -1 },
                        barSx)
                },
                h(LoadingButton, {
                    variant: 'contained',
                    startIcon: h(Save),
                    children: "Save",
                    loading: phase !== Phase.Idle,
                    ...saveBtn,
                    onClick: pleaseSubmit,
                }),
                ...addToBar,
            )
        )
    )

    function pleaseSubmit() { // we use state here to let outer component perform its state changes
        submitAfterValidation.current = true
        pleaseValidate()
    }

    function pleaseValidate(k='') {
        if (phase !== Phase.Idle) return
        validateUpTo.current = k
        setPhase(Phase.WaitValues)
    }

    async function phaseChange() {
        if (phase === Phase.Idle) return
        if (phase === Phase.WaitValues)
            return setPhase(Phase.Validating)
        const MSG = "Please review errors"
        const errs: typeof errors = {}
        for (const f of fields) {
            if (!f || isValidElement(f) || !f.k) continue
            const { k } = f
            const v = values?.[k]
            let err = await apis[k]?.getError()
            if (!err) {
                const res = await f.validate?.(v, { values, fields })
                err = res !== undefined && res !== true && (res || '')
            }
            errs[k] = err
            if (k === validateUpTo.current) break
            if (!mounted.current) return // abort
        }
        setErrors(errs)
        try {
            if (!submitAfterValidation.current) return
            if (Object.values(errs).some(Boolean))
                return await onError?.(MSG)
            const cb = saveBtn.onClick
            if (cb) // @ts-ignore
                await cb()
        }
        catch(e) { await onError?.(e) }
        finally {
            submitAfterValidation.current = false
            if (mounted.current)
                setPhase(Phase.Idle)
        }
    }

}

export function labelFromKey(k: string) {
    return _.capitalize(k.replace(/_/g, ' '))
}

type Promisable<T> = T | Promise<T>
interface FieldApi { getError: () => Promisable<string | false>, [rest: string]: any }
export interface FieldProps<T> {
    label?: string | ReactElement
    value?: T
    onChange: (v: T, more: { was?: T, event: any, [rest: string]: any }) => void
    getApi?: (api: FieldApi) => void
    error?: true
    [rest: string]: any
}

export function StringField({ value, onChange, min, max, required, getApi, typing, start, end, ...props }: FieldProps<string>) {
    const setter = () => value ?? ''
    getApi?.({
        getError() {
            return !value && required ? "required"
                : value?.length! < min ? "too short"
                    : value?.length! > max ? "too long"
                        : false
        }
    })
    const [state, setState] = useState(setter)

    const lastChange = useRef(value)
    useEffect(() => setState(setter), [value]) //eslint-disable-line
    return h(TextField, {
        fullWidth: true,
        InputLabelProps: state || props.placeholder ? { shrink: true } : undefined,
        ...props,
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
                setState(setter)
            }
        })
    }
}

export function DisplayField({ value, empty='-', ...props }: any) {
    if (!props.toField && empty !== undefined && value !== 0 && !value)
        value = empty
    return h(StringField, {  ...props, value, disabled: true })
}

type SelectOptions<T> = { [label:string]:T } | SelectOption<T>[]
type SelectOption<T> = SelectPair<T> | (T extends string | number ? T : never)
interface SelectPair<T> { label: string, value:T }

export function SelectField<T>(props: FieldProps<T> & { options:SelectOptions<T> }) {
    const { value, onChange, getApi, options, sx, ...rest } = props
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

export function MultiSelectField<T>(props: FieldProps<T[]> & { options:SelectOptions<T> }) {
    const { value, onChange, getApi, options, sx, ...rest } = props
    return h(TextField, {
        ...commonSelectProps({ ...props, value: undefined }),
        ...rest,
        SelectProps: { multiple: true },
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

function commonSelectProps<T>(props: { sx?:SxProps, label?: FieldProps<T>['label'], value?: T, disabled?: boolean, options:SelectOptions<T> }) {
    const { options, disabled } = props
    const normalizedOptions = !Array.isArray(options) ? Object.entries(options).map(([label,value]) => ({ value, label }))
        : options.map(o => typeof o === 'string' || typeof o === 'number' ? { value: o, label: String(o) } : o as SelectPair<T>)
    const jsonValue = JSON.stringify(props.value)
    const currentOption = normalizedOptions.find(x => JSON.stringify(x.value) === jsonValue)
    return {
        select: true,
        fullWidth: true,
        sx: props.label ? props.sx : Object.assign({ '& .MuiInputBase-input': { pt: 1 } }, props.sx),
        // avoid warning for invalid option. This can easily happen for a split-second when you keep value in a useState (or other async way) and calculate options with a useMemo (or other sync way) causing a temporary misalignment.
        value: currentOption ? jsonValue : '',
        disabled: !normalizedOptions?.length || disabled,
        children: normalizedOptions.map((o, i) => h(MenuItem, {
            key: i,
            value: JSON.stringify(o?.value),
            children: o?.label
        }))
    }
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
    return h(Box, { ml: 1, mt: 1, sx: error && { color: 'error.main', outlineOffset: 6, outline: '1px solid' } },
        h(FormControlLabel, { label, control, labelPlacement: 'end' }),
        helperText && h(FormHelperText, { error }, helperText)
    )
}

export function RadioField<T>({ label, options, value, onChange }: FieldProps<T> & { options:SelectPair<T>[] }) {
    return h(FormControl, {},
        label && h(FormLabel, {}, label),
        h(RadioGroup, {
            row: true,
            name: '',
            value: JSON.stringify(value),
            onChange(event, v){
                onChange(JSON.parse(v), { was: value, event })
            }
        },
            options.map(({ value, label }, idx) =>
                h(FormControlLabel, { key: idx, value, control: h(Radio), label }) )
        )
    )
}

export function CheckboxesField({ label, options, value, onChange }: FieldProps<string[]> & { options: string[] }) {
    return h(FormControl, {},
        label && h(FormLabel, {}, label),
        h(FormGroup, {},
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

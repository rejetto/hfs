// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    createElement as h,
    FC,
    Fragment,
    HTMLProps,
    isValidElement,
    ReactElement,
    ReactNode,
    useEffect,
    useState,
    useRef,
    MutableRefObject
} from 'react'
import { Box, BoxProps, Button, Grid } from '@mui/material'
import { Save } from '@mui/icons-material'
import { LoadingButton } from '@mui/lab'
import _ from 'lodash'
import { StringField } from './StringField'
import { GridProps } from '@mui/material/Grid/Grid'
import { useDebounce } from 'usehooks-ts'
export * from './SelectField'
export * from './misc-fields'
export { StringField }

type ValidationError = ReactNode // false = no error
export interface FieldDescriptor<T=any> extends FieldApi<T> {
    k: string
    comp?: any
    label?: ReactNode
    error?: ReactNode
    toField?: (v: T) => any
    fromField?: (v: any, { originalValue }: { originalValue: T }) => T
    before?: ReactNode
    after?: ReactNode
    getError?: GetError
    [extraProp: string]: any
}

// it seems necessary to cast (Multi)SelectField sometimes
export type Field<T> = FC<FieldProps<T>>

type GetError = (v: any, extra?: any) => Promisable<ValidationError>
export type Promisable<T> = T | Promise<T>
interface FieldApi<T> {
    // provide getError if you want your error to be visible by the Form component
    getError?: GetError
    isEqual?: (a: T, b: T) => boolean,
}
export interface FieldProps<T> {
    label?: string | ReactElement
    value?: T
    onChange: (v: T, more: { was?: T, event: any, [rest: string]: any }) => void
    setApi?: (api: FieldApi<T>) => void
    error?: boolean
    helperText?: ReactNode
    [rest: string]: any
}

type Dict<T=any> = Record<string,T>

export interface FormProps<Values> extends Partial<BoxProps> {
    fields: (FieldDescriptor | ReactElement | null | undefined | false)[]
    defaults?: (f:FieldDescriptor) => any
    values: Values
    set: (v: any, fieldK: keyof Values) => void
    save: false | Partial<Parameters<typeof Button>[0]> | (()=>any)
    stickyBar?: boolean
    addToBar?: ReactNode[]
    barSx?: Dict
    onError?: (err: any) => any
    formRef?: MutableRefObject<HTMLFormElement | undefined>
    saveOnEnter?: boolean
    gridProps?: Partial<GridProps>
    formProps?: HTMLProps<HTMLFormElement>
}
enum Phase { Idle, WaitValues, Validating }

export function Form<Values extends Dict>({
    fields,
    values,
    set,
    defaults,
    save,
    stickyBar,
    addToBar = [],
    barSx,
    formRef,
    onError,
    saveOnEnter,
    gridProps,
    formProps,
    ...rest
}: FormProps<Values>) {
    const mounted = useRef(false)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const [errors, setErrors] = useState<Dict<ValidationError>>({})
    const [fieldExceptions, setFieldExceptions] = useState<Dict<ValidationError>>({})
    const saveBtn = typeof save === 'function' ? { onClick: save } : save // normalize
    const [phase, setPhase] = useState(Phase.Idle)
    const submitAfterValidation = useRef(false)
    const validateUpTo = useRef('')
    useEffect(() => void(phaseChange()), [phase]) //eslint-disable-line
    const keyMet: Dict<number> = {}

    const apis: Dict<FieldApi<unknown>> = {} // consider { [K in keyof Values]?: FieldApi<Values[K]> }
    return h('form', {
        ref: formRef && (x => formRef.current = x ? x as HTMLFormElement : undefined),
        ...formProps,
        onSubmit(ev) {
            ev.preventDefault()
        },
        onKeyDown(ev) {
            if (saveBtn && !saveBtn.disabled && (ev.ctrlKey || ev.metaKey) && ev.key === 'Enter')
                pleaseSubmit()
        }
    },
        h(Box, {
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            ...rest
        },
            h(Grid, { container:true, rowSpacing:3, columnSpacing:1, ...gridProps },
                fields.map((row, idx) => {
                    if (!row)
                        return null
                    if (isValidElement(row))
                        return h(Grid, { key: idx, item: true, xs: 12 }, row)
                    const { k, fromField=_.identity, toField=_.identity, getError, error, ...field } = row
                    let errMsg = errors[k] || error || fieldExceptions[k]
                    if (errMsg === true)
                        errMsg = "Not valid"
                    if (k) {
                        const originalValue = row.hasOwnProperty('value') ? row.value : values?.[k]
                        const whole = { ...row, ...field }
                        Object.assign(field, {
                            value: toField(originalValue),
                            error: Boolean(errMsg || error) || undefined,
                            setApi(api) { apis[k] = api },
                            onKeyDown(event: any) {
                                if (saveOnEnter && event.key === 'Enter')
                                    pleaseSubmit()
                            },
                            onChange(v: unknown) {
                                try {
                                    v = fromField(v, { originalValue })
                                    setFieldExceptions(x => ({ ...x, [k]: false }))
                                    if ((apis[k]?.isEqual || _.isEqual)(v, originalValue)) return
                                    set(v, k)
                                    pleaseValidate(k)
                                }
                                catch (e) {
                                    setFieldExceptions(x => ({ ...x, [k]: (e as any)?.message || String(e) || true }))
                                }
                            },
                        } as Partial<FieldProps<any>>)
                        if (Array.isArray(field.helperText))
                            field.helperText = h(Fragment, {}, ...field.helperText)
                        if (errMsg) // special rendering when we have both error and helperText. "hr" would be nice but issues a warning because contained in a <p>
                            field.helperText = !field.helperText ? errMsg
                                : h(Fragment, {},
                                    h('span', { style: { borderBottom: '1px solid' } }, errMsg),
                                    h(Box, { color: 'text.primary', component: 'span', /*avoid console warning*/ display: 'block' },
                                        field.helperText),
                                )
                        if (field.label === undefined)
                            field.label = labelFromKey(k)
                        _.defaults(field, defaults?.(whole))
                    }
                    {
                        const { xs=12, sm, md, lg, xl, comp=StringField, before, after,
                            fromField, toField, // don't propagate
                            ...rest } = field
                        Object.assign(rest, { name: k })
                        const n = (keyMet[k] = (keyMet[k] || 0) + 1)
                        return h(Grid, { key: k ? k + n : idx, item: true, xs, sm, md, lg, xl },
                            before,
                            isValidElement(comp) ? comp : h(comp, rest),
                            after
                        )
                    }
                })
            ),
            saveBtn && h(Box, {
                display: 'flex',
                alignItems: 'center',
                sx: Object.assign({},
                    stickyBar && {
                        width: 'fit-content', zIndex: 2, backgroundColor: 'background.paper', borderRadius: 1,
                        position: 'sticky', bottom: 0, p: 1, m: -1, boxShadow: '0px 0px 30px #000',
                    },
                    barSx)
            },
                h(LoadingButton, {
                    variant: 'contained',
                    startIcon: h(Save),
                    children: "Save",
                    loading: useDebounce(phase !== Phase.Idle), // debounce fixes click being ignored at state change, and flickering
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
        setTimeout(() => // starting validation immediately will lose clicks on the saveBtn, so delay just a bit
            setPhase(cur => cur === Phase.Idle ? Phase.WaitValues : cur)) // don't interfere with ongoing process
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
            const err = await apis[k]?.getError?.(v, { values, fields })
                || await f.getError?.(v, { values, fields })
                || fieldExceptions[k]
            errs[k] = err || false
            if (!submitAfterValidation.current && k === validateUpTo.current) break
            if (!mounted.current) return // abort
        }
        setErrors(errs)
        try {
            if (!submitAfterValidation.current) return
            if (Object.values(errs).some(Boolean))
                return await onError?.(MSG)
            const cb = saveBtn && saveBtn.onClick
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
    return _.upperFirst(k.indexOf('_') > 0 ? k.replace(/_/g, ' ')
        : k.replace(/([a-z])([A-Z])/g, (all,a,b) => a + ' ' + b.toLowerCase()))
}

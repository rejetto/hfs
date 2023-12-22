import { Form, FormProps } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { createElement as h, useEffect, useState, Dispatch } from 'react'
import _ from 'lodash'
import { IconBtn, modifiedSx } from './mui'
import { RestartAlt } from '@mui/icons-material'
import { Callback } from '../../src/cross'

type FormRest<T> = Omit<FormProps<T>, 'values' | 'set' | 'save'> & Partial<Pick<FormProps<T>, 'save'>>
export function ConfigForm<T=any>({ keys, form, saveOnChange, onSave, ...rest }: Partial<FormRest<T>> & {
    keys: (keyof T)[],
    form: FormRest<T> | ((values: T, optional: { setValues: Dispatch<T> }) => FormRest<T>),
    onSave?: Callback,
    saveOnChange?: boolean
}) {
    const config = useApiEx('get_config', { only: keys })
    const [values, setValues] = useState<any>(config.data)
    useEffect(() => setValues((v: any) => config.data || v), [config.data])
    const modified = values && !_.isEqual(values, config.data)
    useEffect(() => {
        if (modified && saveOnChange) save()
    }, [modified])
    if (!values)
        return config.element
    const formProps = _.isFunction(form) ? form(values, { setValues }) : form
    return h(Form, {
        values,
        set(v, k) {
            setValues((was: any) => ({ ...was, [k]: v }))
        },
        save: saveOnChange ? false : {
            onClick: save,
            sx: modifiedSx(modified),
        },
        ...Array.isArray(formProps) ? { fields: formProps } : formProps,
        ...rest,
        barSx: { gap: 1, ...rest.barSx },
        addToBar: [
            h(IconBtn, {
                icon: RestartAlt,
                disabled: !modified,
                title: "Reset",
                onClick(){ setValues(config.data) }
            }),
            ...rest.addToBar||[],
        ],
    })

    function save() {
        return apiCall('set_config', { values }).then(onSave).then(config.reload)
    }
}
import { Form, FormProps } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { createElement as h, useEffect, useState, Dispatch } from 'react'
import _ from 'lodash'
import { IconBtn, modifiedProps } from './mui'
import { RestartAlt } from '@mui/icons-material'
import { Callback, onlyTruthy } from '../../src/cross'

type FormRest<T> = Omit<FormProps<T>, 'values' | 'set' | 'save'> & Partial<Pick<FormProps<T>, 'save'>>
export function ConfigForm<T=any>({ keys, form, saveOnChange, onSave, ...rest }: Partial<FormRest<T>> & {
    keys?: (keyof T)[],
    form: FormRest<T> | ((values: T, optional: { setValues: Dispatch<T> }) => FormRest<T>),
    onSave?: Callback,
    saveOnChange?: boolean
}) {
    const [keys_, setKeys_] = useState(keys)
    const config = useApiEx(keys_ && 'get_config', { only: keys_ })
    const [values, setValues] = useState<any>(config.data)
    useEffect(() => setValues((v: any) => config.data || v), [config.data])
    const modified = values && !_.isEqual(values, config.data)
    useEffect(() => {
        if (modified && saveOnChange) save()
    }, [modified])
    const formProps = _.isFunction(form) ? form(values, { setValues }) : form
    useEffect(() => {
        if (!keys) // autodetect keys
            setKeys_(onlyTruthy(formProps.fields.map(x => (x as any)?.k)))
    }, [keys])
    if (!values)
        return config.element
    return h(Form, {
        values,
        set(v, k) {
            setValues((was: any) => ({ ...was, [k]: v }))
        },
        save: saveOnChange ? false : {
            onClick: save,
            ...modifiedProps(modified),
        },
        ...formProps,
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
import { createElement as h, useRef, useState } from 'react'
import { Button } from '@mui/material'
import { Form, FormApi } from '@hfs/mui-grid-form'
import { ConfigForm } from '../../admin/src/ConfigForm'

export default function FormValidationFixture() {
    const api = useRef<FormApi>()
    const [values, setValues] = useState({ name: 'saved' })
    const [pending, setPending] = useState(false)
    const [result, setResult] = useState('')
    const [saves, setSaves] = useState(0)
    const release = useRef<() => void>()
    const holdValidation = useRef(false)
    return h('div', {},
        h(Form, {
            values, apiRef: api,
            set(v, k) { setValues(was => ({ ...was, [k]: v })) },
            fields: [{ k: 'name', label: 'Name',
                fromField(value: string) {
                    if (value === 'throw') throw Error('Conversion failed')
                    return value
                },
                getError(value: string) {
                    if (holdValidation.current) {
                        holdValidation.current = false
                        setPending(true)
                        return new Promise<string | false>(resolve => {
                            release.current = () => {
                                setPending(false)
                                resolve(value === 'bad' ? 'Stale error' : false)
                            }
                        })
                    }
                    return value === 'bad' && 'Invalid name'
                },
            }],
            save: { onClick() { setSaves(n => n + 1) } },
            addToBar: [h(Button, { key: 'reset', onClick() {
                setValues({ name: 'saved' })
                api.current?.resetValidation()
            } }, 'Reset form')],
        }),
        h(Button, { onClick() { holdValidation.current = true } }, 'Hold validation'),
        h(Button, { onClick: () => void api.current?.validate().then(ok => setResult(String(ok))) }, 'Validate'),
        h(Button, { onClick: () => release.current?.() }, 'Finish validation'),
        h('output', { 'data-testid': 'pending' }, String(pending)),
        h('output', { 'data-testid': 'result' }, result),
        h('output', { 'data-testid': 'saves' }, saves),
        h(ConfigForm, { form: { fields: [{ k: 'setting', label: 'Setting', getError: (v: string) => v === 'bad' && 'Invalid setting' }] } }),
    )
}

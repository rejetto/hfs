import { createElement as h, useState } from 'react'
import { Form } from '../../mui-grid-form'
import { DateTimeField } from '../../admin/src/DateTimeField'

declare global {
    interface Window { savedDate?: string; dateError?: unknown }
}

export default function DateFixture() {
    const [values, setValues] = useState({ when: new Date('2026-09-09T12:00:00Z') })
    return h(Form, {
        values, set: (v, k) => setValues(old => ({ ...old, [k]: v })),
        onError: err => { window.dateError = err },
        fields: [{ k: 'when', label: 'When', comp: DateTimeField }],
        save: () => { window.savedDate = JSON.stringify(values) },
    })
}

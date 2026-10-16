import { createElement as h, Fragment, useState } from 'react'
import { hfsEvent } from './misc'

export function readPluginSearch(raw?: string): Record<string, unknown> {
    try {
        const value = raw ? JSON.parse(raw) : {}
        if (value && typeof value === 'object' && !Array.isArray(value)) return value
    }
    catch {}
    return {}
}

export function PluginSearchFields({ fields, initial }: {
    fields: readonly { id: string, label: string }[], initial?: string
}) {
    const [values, setValues] = useState(() => readPluginSearch(initial))
    return h(Fragment, {},
        h('input', { type: 'hidden', name: 'pluginSearch', value: Object.keys(values).length ? JSON.stringify(values) : '' }),
        ...fields.map(({ id, label }) => {
            const value = values[id]
            function onChange(next: unknown) {
                setValues(previous => {
                    const updated = { ...previous }
                    if (next === undefined || next === null || next === '')
                        delete updated[id]
                    else
                        updated[id] = next
                    return updated
                })
            }
            const custom = hfsEvent('searchFields:' + id, { value, onChange }).filter(x => x !== undefined)
            return h('fieldset', { key: id },
                h('legend', {}, label),
                ...(custom.length ? custom : [h('input', {
                    'aria-label': label, value: typeof value === 'string' ? value : '',
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value),
                })]),
            )
        }),
    )
}

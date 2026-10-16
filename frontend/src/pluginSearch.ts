import { createElement as h, useState } from 'react'
import { hfsEvent } from './misc'
import i18n from './i18n'
import { parsePluginSearch } from '../../src/pluginSearchQuery'
import SearchFieldset from './SearchFieldset'
const { t } = i18n

export function pluginSearchLabel({ label, labelKey }: { label: string, labelKey?: string }) {
    return labelKey ? t(labelKey, label) : label
}

export function readPluginSearch(raw?: string): Record<string, unknown> {
    try {
        return parsePluginSearch(raw)
    }
    catch {}
    return {}
}

export function PluginSearchFields({ fields, initial }: {
    fields: readonly { id: string, label: string, labelKey?: string }[], initial?: string
}) {
    const [values, setValues] = useState(() => readPluginSearch(initial))
    return h('div', { className: 'search-plugin-fields' },
        h('input', { type: 'hidden', name: 'pluginSearch', value: Object.keys(values).length ? JSON.stringify(values) : '' }),
        ...fields.map(field => {
            const { id } = field
            const label = pluginSearchLabel(field)
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
            return h(SearchFieldset, { key: id, label, expanded: id in readPluginSearch(initial) },
                ...(custom.length ? custom : [h('input', {
                    'aria-label': label, value: typeof value === 'string' ? value : '',
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value),
                })]),
            )
        }),
    )
}

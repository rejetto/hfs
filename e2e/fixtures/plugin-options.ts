import { createElement as h } from 'react'
import { Button } from '@mui/material'
import { showPluginOptions } from '../../admin/src/pluginOptions'

export default function PluginOptionsFixture() {
    const fields = { label: { type: 'string', defaultValue: 'new entry' }, count: { type: 'number', defaultValue: 7 }, omitted: null }
    return h(Button, { onClick: () => showPluginOptions({
        id: 'fixture',
        config: {
            name: { type: 'string', typing: true },
            entries: { type: 'array', label: 'Entries', fields: `() => (${JSON.stringify(fields)})` },
        },
    }, '40em') }, 'Open plugin options')
}

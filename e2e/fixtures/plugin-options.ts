import { createElement as h } from 'react'
import { Button } from '@mui/material'
import { showPluginOptions } from '../../admin/src/pluginOptions'

export default function PluginOptionsFixture() {
    const fields = {
        label: { type: 'string', defaultValue: 'new entry' },
        count: { type: 'number', defaultValue: 7 },
        password: { type: 'password' },
        omitted: null,
    }
    return h(Button, { onClick: () => showPluginOptions({
        id: 'fixture',
        configDialog: { sx: { maxWidth: '40em' } },
        config: {
            name: { type: 'string', typing: true },
            entries: { type: 'array', label: 'Entries', fields: `() => (${JSON.stringify(fields)})` },
        },
    }) }, 'Open plugin options')
}

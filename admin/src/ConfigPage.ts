import { Box, Button } from '@mui/material';
import { createElement as h, isValidElement, useRef } from 'react';
import { apiCall, useApiComp } from './api'
import { state, useSnapState } from './state'
import { Refresh } from '@mui/icons-material'
import { Dict } from './misc'
import { subscribeKey } from 'valtio/utils'
import { Form, BoolField, NumberField, StringField, SelectField, FieldProps, Field } from './Form';
import StringStringField from './StringStringField'
import { alertDialog } from './dialog'

let loaded: Dict | undefined

subscribeKey(state, 'config', recalculateChanges)

export default function ConfigPage() {
    const [res, reload] = useApiComp('get_config', {
        omit: ['vfs', 'accounts']
    })
    let snap = useSnapState()
    if (isValidElement(res))
        return res
    const { changes } = snap
    const config = (loaded !== res) ? (state.config = loaded = res) : snap.config
    return h(Form, {
        sx: { maxWidth:'80em' },
        values: config,
        set(v, { k }) {
            if (v || config[k])
                state.config[k] = v
        },
        sticky: true,
        save: {
            onClick: save,
            disabled: !Object.keys(changes).length,
        },
        addToBar: [h(Button, {
            onClick: reload,
            startIcon: h(Refresh),
        }, 'Reload')],
        defaults({ comp }) {
            const shortField = comp === NumberField || comp === BoolField
            return { md: shortField ? 3 : 6 }
        },
        fields: [
            { k: 'port', comp: ServerPort, label:'HTTP port' },
            { k: 'https_port', comp: ServerPort, label: 'HTTPS port' },
            config.https_port >= 0 && { k: 'cert', comp: StringField, label: 'HTTPS certificate file' },
            config.https_port >= 0 && { k: 'private_key', comp: StringField, label: 'HTTPS private key file' },
            { k: 'admin_port', comp: ServerPort, label: 'Admin port' },
            { k: 'admin_network', comp: SelectField, label: 'Admin access',
                options:[
                    { value: '127.0.0.1', label: 'localhost only' },
                    { value: '0.0.0.0', label: 'any network' }
                ]
            },
            { k: 'max_kbps', comp: NumberField, label: 'Max KB/s', helperText: "Limit output bandwidth" },
            { k: 'max_kbps_per_ip', comp: NumberField, label: 'Max KB/s per-ip' },
            { k: 'log', comp: StringField, label: 'Main log file' },
            { k: 'error_log', comp: StringField, label: 'Error log file' },
            { k: 'accounts', comp: StringField, label: 'Accounts file' },
            { k: 'open_browser_at_start', comp: BoolField },
            { k: 'zip_calculate_size_for_seconds', comp: NumberField, label: 'Calculate ZIP size for seconds',
                helperText: "If time is not enough the browser will not show download percentage" },
            { k: 'mime', comp: StringStringField,
                keyLabel: 'Files', keyWidth: 7,
                valueLabel: 'Mime type', valueWidth: 4
            },
        ]
    })

    async function save() {
        await apiCall('set_config', { values: state.changes })
        Object.assign(loaded, state.changes) // since changes are recalculated subscribing state.config, but it depends on 'loaded' to (which cannot be subscribed), be sure to update loaded first
        recalculateChanges()
        console.debug('saved')
        await alertDialog("Changes applied")
    }
}

function recalculateChanges() {
    const changes: Dict = {}
    if (state.config)
        for (const [k, v] of Object.entries(state.config))
            if (JSON.stringify(v) !== JSON.stringify(loaded?.[k]))
                changes[k] = v
    state.changes = changes
    console.debug('changes', Object.keys(changes))
}

function ServerPort({ label, value, onChange }: FieldProps<number | null>) {
    const lastCustom = useRef(1)
    if (value! > 0)
        lastCustom.current = value!
    const selectValue = Number(value! > 0 ? lastCustom.current : value) || 0
    return h(Box, { display:'flex' },
        h(SelectField as Field<number>, {
            sx: { flexGrow: 1 },
            label,
            value: selectValue,
            options: [
                { label: 'off', value: -1 },
                { label: 'automatic port', value: 0 },
                { label: 'choose port number', value: lastCustom.current },
            ],
            onChange,
        }),
        value! > 0 && h(NumberField, { label: 'Number', fullWidth: false, value, onChange }),
    )
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, FormHelperText } from '@mui/material';
import { createElement as h, isValidElement, useEffect, useRef } from 'react';
import { apiCall, useApi, useApiComp } from './api'
import { state, useSnapState } from './state'
import { Refresh } from '@mui/icons-material'
import { Dict, modifiedSx } from './misc'
import { subscribeKey } from 'valtio/utils'
import { Form, BoolField, NumberField, StringField, SelectField, FieldProps, Field } from './Form';
import StringStringField from './StringStringField'
import { alertDialog, confirmDialog } from './dialog'

let loaded: Dict | undefined

subscribeKey(state, 'config', recalculateChanges)

export default function ConfigPage() {
    const [res, reloadConfig] = useApiComp('get_config', { omit: ['vfs'] })
    let snap = useSnapState()
    const [status, reloadStatus] = useApi(res && 'get_status')
    useEffect(reloadStatus, [res, reloadStatus])
    if (isValidElement(res))
        return res
    const { changes } = snap
    const values = (loaded !== res) ? (state.config = loaded = res) : snap.config
    const maxSpeedDefaults = {
        comp: NumberField,
        min: 1,
        placeholder: "no limit",
        onChange: (v: any) => v < 1 ? '' : v
    }
    return h(Form, {
        sx: { maxWidth: '60em' },
        values,
        set(v, k) {
            if (v || values[k])
                state.config[k] = v
        },
        stickyBar: true,
        onError: alertDialog,
        save: {
            onClick: save,
            sx: modifiedSx( Object.keys(changes).length>0),
        },
        barSx: { gap: 2 },
        addToBar: [h(Button, {
            onClick() {
                reloadConfig()
                reloadStatus()
            },
            startIcon: h(Refresh),
        }, "Reload")],
        defaults({ comp }) {
            return comp === ServerPort ? { sm:  6, lg: 3 }
                : comp === NumberField ? { sm: 3 }
                    : { sm:  6 }
        },
        fields: [
            { k: 'port', comp: ServerPort, label:"HTTP port", status: status?.http||true, suggestedPort: 80 },
            { k: 'https_port', comp: ServerPort, label: "HTTPS port", status: status?.https||true, suggestedPort: 443 },
            values.https_port >= 0 && { k: 'cert', label: "HTTPS certificate file" },
            values.https_port >= 0 && { k: 'private_key', label: "HTTPS private key file" },
            { k: 'max_kbps',        ...maxSpeedDefaults, label: "Limit output KB/s" },
            { k: 'max_kbps_per_ip', ...maxSpeedDefaults, label: "Limit output KB/s per-ip" },
            { k: 'log', label: "Main log file" },
            { k: 'error_log', label: "Error log file" },
            { k: 'log_rotation', comp: SelectField, options: [{ value:'', label:"disabled" }, 'daily', 'weekly', 'monthly' ],
                helperText: "To avoid an endlessly-growing single log file, you can opt for rotation"
            },
            { k: 'accounts', label: "Accounts file" },
            { k: 'open_browser_at_start', comp: BoolField },
            { k: 'allowed_referer', placeholder: "any", helperText: values.allowed_referer && "Leave empty to allow any", },
            { k: 'zip_calculate_size_for_seconds', comp: NumberField, sm:  6, label: "Calculate ZIP size for seconds",
                helperText: "If time is not enough, the browser will not show download percentage" },
            { k: 'mime', comp: StringStringField,
                keyLabel: "Files", keyWidth: 7,
                valueLabel: "Mime type", valueWidth: 4
            },
            { k: 'block', label: "Blocked IPs", multiline: true, minRows:3, helperText: "Enter an IP address for each line",
                fromField: (all:string) => all.split('\n').map(s => s.trim()).filter(Boolean).map(ip => ({ ip })),
                toField: (all: any) => !Array.isArray(all) ? '' : all.map(x => x?.ip).filter(Boolean).join('\n')
            },
        ]
    })

    async function save() {
        const values = state.changes
        const loc = window.location
        const newPort = loc.protocol === 'http:' ? values.port : values.https_port
        if (newPort <= 0 && !await confirmDialog("You are switching off the server port and you will be disconnected"))
            return
        else if (newPort > 0 && !await confirmDialog("You are changing the port and you may be disconnected"))
            return
        await apiCall('set_config', { values })
        if (newPort > 0) {
            await alertDialog("You are being redirected but in some cases this may fail. Hold on tight!", 'warning')
            return window.location.href = loc.protocol + '//' + loc.hostname + ':' + newPort + loc.pathname
        }
        setTimeout(reloadStatus, 1000)
        Object.assign(loaded, values) // since changes are recalculated subscribing state.config, but it depends on 'loaded' to (which cannot be subscribed), be sure to update loaded first
        recalculateChanges()
        await alertDialog("Changes applied", 'success')
    }
}

function recalculateChanges() {
    const changes: Dict = {}
    if (state.config)
        for (const [k, v] of Object.entries(state.config))
            if (JSON.stringify(v) !== JSON.stringify(loaded?.[k]))
                changes[k] = v
    state.changes = changes
}

function ServerPort({ label, value, onChange, status, suggestedPort=1 }: FieldProps<number | null>) {
    const lastCustom = useRef(suggestedPort)
    if (value! > 0)
        lastCustom.current = value!
    const selectValue = Number(value! > 0 ? lastCustom.current : value) || 0
    const error = status?.error
    return h(Box, {},
        h(Box, { display: 'flex' },
            h(SelectField as Field<number>, {
                sx: { flexGrow: 1 },
                label,
                value: selectValue,
                options: [
                    { label: "off", value: -1 },
                    { label: "automatic", value: 0 },
                    { label: "choose", value: lastCustom.current },
                ],
                onChange,
            }),
            value! > 0 && h(NumberField, { label: 'Number', fullWidth: false, value, onChange }),
        ),
        status && h(FormHelperText, { error: Boolean(error) },
            status === true ? '...'
                : error ?? (status?.listening && "Correctly working on port "+ status.port) )
    )
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, FormHelperText, Link } from '@mui/material';
import { createElement as h, isValidElement, useEffect, useRef } from 'react';
import { apiCall, useApi, useApiComp } from './api'
import { state, useSnapState } from './state'
import { Info, Refresh } from '@mui/icons-material'
import { Dict, modifiedSx } from './misc'
import { subscribeKey } from 'valtio/utils'
import { Form, BoolField, NumberField, SelectField, FieldProps, Field } from './Form';
import StringStringField from './StringStringField'
import FileField from './FileField'
import { alertDialog, closeDialog, confirmDialog, formDialog, newDialog, toast, waitDialog } from './dialog'
import { proxyWarning } from './HomePage'

let loaded: Dict | undefined
let exposedReloadStatus: undefined | (() => void)

subscribeKey(state, 'config', recalculateChanges)

export const logLabels = {
    log: "Access log file",
    error_log: "Error log file"
}

export default function ConfigPage() {
    const [res, reloadConfig] = useApiComp('get_config', { omit: ['vfs'] })
    let snap = useSnapState()
    const [status, reloadStatus] = useApiComp(res && 'get_status')
    useEffect(reloadStatus, [res, reloadStatus])

    exposedReloadStatus = reloadStatus
    useEffect(() => () => exposedReloadStatus = undefined, []) // clear on unmount

    const admins = useApi('get_admins')[0]?.list

    if (isValidElement(res))
        return res
    if (isValidElement(status))
        return status
    const { changes } = snap
    const values = (loaded !== res) ? (state.config = loaded = res) : snap.config
    const maxSpeedDefaults = {
        comp: NumberField,
        min: 1,
        placeholder: "no limit",
        onChange: (v: any) => v < 1 ? null : v,
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
                    : { sm: 6 }
        },
        fields: [
            { k: 'max_kbps',        ...maxSpeedDefaults, label: "Limit output KB/s", helperText: "Doesn't apply to localhost" },
            { k: 'max_kbps_per_ip', ...maxSpeedDefaults, label: "Limit output KB/s per-ip" },
            { k: 'port', comp: ServerPort, label:"HTTP port", status: status?.http||true, suggestedPort: 80 },
            { k: 'https_port', comp: ServerPort, label: "HTTPS port", status: status?.https||true, suggestedPort: 443,
                onChange(v: number) {
                    if (v >= 0 && values.https_port < 0 && !values.cert)
                        suggestMakingCert()
                    return v
                }
            },
            values.https_port >= 0 && { k: 'cert', comp: FileField, label: "HTTPS certificate file" },
            values.https_port >= 0 && { k: 'private_key', comp: FileField, label: "HTTPS private key file" },
            { k: 'open_browser_at_start', comp: BoolField },
            { k: 'localhost_admin', comp: BoolField, label: "Admin access for localhost connections",
                validate: x => x || !admins || admins.length>0 || "First create at least one admin account",
                helperText: "To access Admin without entering credentials"
            },
            ...Object.entries(logLabels).map(a => ({ k: a[0], label: a[1], lg: 3 })),
            { k: 'log_rotation', comp: SelectField, options: [{ value:'', label:"disabled" }, 'daily', 'weekly', 'monthly' ],
                helperText: "To avoid an endlessly-growing single log file, you can opt for rotation"
            },
            { k: 'proxies', comp: NumberField, min: 0, max: 9, sm: 6, lg: 6, label: "How many HTTP proxies between this server and users?",
                error: proxyWarning(values, status),
                helperText: "Wrong number will prevent detection of users' IP address"
            },
            { k: 'allowed_referer', placeholder: "any",
                helperText: values.allowed_referer ? "Leave empty to allow any" : "Use this to avoid direct links from other websites", },
            { k: 'zip_calculate_size_for_seconds', comp: NumberField, sm:  6, label: "Calculate ZIP size for seconds",
                helperText: "If time is not enough, the browser will not show download percentage" },
            { k: 'custom_header', multiline: true, sx: { '& textarea': { fontFamily: 'monospace' } },
                helperText: "Any HTML code here will be used as header for the Frontend"
            },
            { k: 'mime', comp: StringStringField,
                keyLabel: "Files", keyWidth: 7,
                valueLabel: "Mime type", valueWidth: 4
            },
            { k: 'block', label: "Blocked IPs", multiline: true, minRows:3, helperText: "Enter an IP address for each line. CIDR and * are supported.",
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
        if (loc.protocol === 'https:' && ('cert' in values || 'private_key' in values) && !await confirmDialog("You may disrupt https service, kicking you out"))
            return
        await apiCall('set_config', { values })
        if (newPort > 0) {
            await alertDialog("You are being redirected but in some cases this may fail. Hold on tight!", 'warning')
            return window.location.href = loc.protocol + '//' + loc.hostname + ':' + newPort + loc.pathname
        }
        setTimeout(reloadStatus, 1000)
        Object.assign(loaded, values) // since changes are recalculated subscribing state.config, but it depends on 'loaded' to (which cannot be subscribed), be sure to update loaded first
        recalculateChanges()
        toast("Changes applied", 'success')
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

export function isCertError(error: any) {
    return typeof error === 'string' && /certificate|key/.test(error)
}

function ServerPort({ label, value, onChange, status, suggestedPort=1 }: FieldProps<number | null>) {
    const lastCustom = useRef(suggestedPort)
    if (value! > 0)
        lastCustom.current = value!
    const selectValue = Number(value! > 0 ? lastCustom.current : value) || 0
    let error = status?.error
    if (isCertError(error))
        error = [error, ' - ', h(Link, { key: 'fix', sx: { cursor: 'pointer' }, onClick: makeCertAndSave }, "make one")]
    return h(Box, {},
        h(Box, { display: 'flex' },
            h(SelectField as Field<number>, {
                sx: { flexGrow: 1 },
                label,
                value: selectValue,
                options: [
                    { label: "off", value: -1 },
                    { label: "random", value: 0 },
                    { label: "choose", value: lastCustom.current },
                ],
                onChange,
            }),
            value! > 0 && h(NumberField, { label: 'Number', fullWidth: false, value, onChange, min: 1, max: 65535, sx: { minWidth:'5.5em' } }),
        ),
        status && h(FormHelperText, { error: Boolean(error) },
            status === true ? '...'
                : error ?? (status?.listening && "Correctly working on port "+ status.port) )
    )
}

function suggestMakingCert() {
    newDialog({
        Content: () => h(Box, {},
            h(Box, { display: 'flex', gap: 1 },
                h(Info), "You are enabling HTTPs. It needs a valid certificate + private key to work."
            ),
            h(Box, { mt: 4, display: 'flex', gap: 1, justifyContent: 'space-around', },
                h(Button, { variant: 'contained', onClick(){
                    closeDialog()
                    makeCertAndSave().then()
                } }, "Help me!"),
                h(Button, { onClick: closeDialog }, "I will handle the matter myself"),
            ),
        )
    })
}

export async function makeCertAndSave() {
    if (!window.crypto.subtle)
        return alertDialog("Retry this procedure on localhost", 'warning')
    const res = await formDialog<{ commonName: string }>({
        fields: [
            h(Box, { display: 'flex', gap: 1 }, h(Info), "We'll generate a basic certificate for you"),
            { k: 'commonName', label: "Enter a domain, or leave empty" }
        ],
        save: { children: "Continue" },
    })
    if (!res) return
    const close = waitDialog()
    try {
        const saved = await apiCall('save_pem', await makeCert(res))
        await apiCall('set_config', { values: saved })
        if (loaded) // when undefined we are outside of this page
            Object.assign(loaded, saved)
        setTimeout(exposedReloadStatus!, 1000) // give some time for backend to apply
        Object.assign(state.config, saved)
        await alertDialog("Certificate saved", 'success')
    }
    finally { close() }
}

async function makeCert(attributes: Record<string, string>) {
    // this relies on having loaded node-forge/dist/forge.min.js
    const { pki } = (window as any).forge
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

    const attrs = Object.entries(attributes).map(x => ({ name: x[0], value: x[1] }))
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey)

    return {
        cert: pki.certificateToPem(cert),
        private_key: pki.privateKeyToPem(keys.privateKey),
    }
}

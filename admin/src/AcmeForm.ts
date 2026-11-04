import { createElement as h, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Grid, Link, LinearProgress } from '@mui/material'
import { Send } from '@mui/icons-material'
import { BoolField, SelectField, StringField } from '@hfs/mui-grid-form'
import { apiCall, useApiEvents, useApiEx } from './api'
import { confirmDialog, alertDialog } from './dialog'
import { t, translateText } from './i18n'
import { isIP, md } from './misc'
import type { AcmeSettings } from '../../src/acmeConfig'
import type { DnsProviderInfo } from '../../src/acmeDns'
import type { AcmeStatus } from '../../src/acme'
import { Btn, Flex } from './mui'

export default function AcmeForm({ onComplete, checkDomain, fresh, renewError }: {
    renewError?: string
    onComplete(): void
    checkDomain(domain: string): Promise<unknown>
    fresh(domain: string): boolean
}) {
    const settings = useApiEx('get_acme')
    const { data: progress, error: streamError } = useApiEvents<AcmeStatus>('get_acme_status')
    const [values, setValues] = useState<AcmeSettings>()
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const pending = useRef<Promise<unknown>>(Promise.resolve())
    const completed = useRef(0)
    useEffect(() => { if (settings.data) setValues(settings.data) }, [settings.data])
    useEffect(() => {
        if (progress?.state === 'done' && progress.id !== completed.current) {
            completed.current = progress.id
            onComplete()
        }
    }, [progress?.id, progress?.state])
    if (!values) return settings.element
    const providers: DnsProviderInfo[] = settings.data?.providers || []
    const config = values.dns[0]
    const provider = providers.find(p => p.id === config?.provider)
    const running = progress?.state === 'running'
    const wildcard = values.domain.includes('*.')
    const wildcardError = t`HTTP validation cannot issue wildcard certificates. Select a DNS provider.`
    const method = values.challenge === 'http-01' ? 'http' : config?.provider || 'dns'
    const incompatible = values.challenge === 'dns-01' && config
        && (!provider?.available || provider.config_version !== config.config_version)
    return h(Box, { sx: { display: 'grid', gap: 2 } },
        md(t('generate_lets_encrypt_certificate', { letsEncryptUrl: 'https://letsencrypt.org' })),
        h(StringField, {
            label: t`Domain for certificate`, value: values.domain.replaceAll(',', '\n'), multiline: true, required: true, disabled: running,
            helperText: md(t`certificate_domains_example`),
            onChange(value) {
                const domain = value.replaceAll('\n', ',')
                update({ domain, ...domain.includes('*.') && { challenge: 'dns-01' as const } })
            },
        }),
        values.domain.split(',').some(isIP) && h(Alert, { severity: 'info' }, t`acme_ip_short_lived_notice`),
        h(SelectField<string>, {
            label: t`Validation`, value: method, disabled: running,
            options: [
                { value: 'http', label: 'HTTP' },
                ...method === 'dns' ? [{ value: 'dns', label: t`Select a DNS provider`, disabled: true }] : [],
                ...config && !provider ? [{ value: config.provider, label: 'DNS · ' + config.provider, disabled: true }] : [],
                ...providers.map(p => ({ value: p.id, label: 'DNS · ' + p.label, disabled: !p.available })),
            ],
            helperText: md(t('acme_validation_help', { url: 'https://github.com/rejetto/hfs/wiki/Certificate-validation' })),
            onChange(value) {
                if (value === 'http' && wildcard)
                    return alertDialog(wildcardError, 'error')
                const selected = providers.find(p => p.id === value)
                update(value === 'http' ? { challenge: 'http-01' } : {
                    challenge: 'dns-01', dns: selected ? [{ id: config?.id || 'main', provider: value,
                        config_version: selected.config_version, credentials: {},
                        ...config?.provider === value && config.config_version === selected.config_version ? config : {},
                    }] : [],
                })
            },
        }),
        incompatible && h(Alert, { severity: 'error' }, t`DNS provider unavailable or incompatible; update HFS or reconfigure the provider`),
        incompatible && provider?.available && h(Button, {
            onClick: () => update({ dns: [{ id: config!.id, provider: provider.id, config_version: provider.config_version, credentials: {} }] }),
        }, t`Reconfigure provider`),
        values.challenge === 'dns-01' && provider?.help_url && h(Link, { href: provider.help_url, target: '_blank', rel: 'noopener' }, t`How to get credentials`),
        values.challenge === 'dns-01' && config && provider && h(Grid, { container: true, spacing: 2 },
            Object.entries(provider.fields).map(([key, field]) =>
                h(Grid, { key, size: { xs: 12, sm: 6 } },
                    h(StringField, {
                        label: t(field.label || key), value: config.credentials[key] || '', disabled: running,
                        type: field.secret ? 'password' : 'text', autoComplete: 'off',
                        onChange(value) {
                            update({ dns: [{ ...config, credentials: { ...config.credentials, [key]: value } }] })
                        },
                    }) ))),
        h(Flex, { justifyContent: 'space-between' },
            h(BoolField, {
                label: t`Automatic renew before expiration`, value: values.renew, disabled: running || !values.domain,
                onChange: renew => update({ renew })
            }),
            h(Btn, {
                icon: Send,
                onClick: request,
                disabled: running || saving || !values.domain || Boolean(incompatible) || values.challenge === 'dns-01' && !provider,
            }, t`Request`),
        ),
        renewError && h(Alert, { severity: 'error' }, renewError),
        error && h(Alert, { severity: 'error' }, error),
        streamError && h(Alert, { severity: 'warning' }, t`Connection lost; reopen this page to check the certificate request.`),
        progress?.state !== 'idle' && progress?.message && h(Alert, { severity: progress.state === 'error' ? 'error' : progress.state === 'done' ? 'success' : 'info' },
            translateText(progress.message), progress.domain && ' · ' + progress.domain),
        progress?.warning && h(Alert, { severity: 'warning' }, translateText(progress.warning)),
        running && h(LinearProgress),
    )

    function update(patch: Partial<AcmeSettings>) {
        const next = { ...values!, ...patch }
        setValues(next)
        setSaving(true)
        setError('')
        // serialize autosaves so a slower earlier request cannot replace newer settings
        const save = pending.current.catch(() => {}).then(() => apiCall('set_acme', { settings: next }))
        pending.current = save
        void save.catch(e => setError(String(e))).finally(() => {
            if (pending.current === save) setSaving(false)
        })
    }
    async function request() {
        try {
            if (wildcard && values!.challenge === 'http-01') throw Error(wildcardError)
            await pending.current
            const [domain, ...altNames] = values!.domain.split(',')
            if (fresh(domain) && !await confirmDialog(t`Your certificate is still good`, { trueText: t`Make a new one anyway` })) return
            if (values!.challenge === 'http-01') {
                if (!await confirmDialog(t`acme_http_port_requirement`)) return
                if (await checkDomain(domain)) return
            }
            await apiCall('make_cert', { domain, altNames, background: true })
        }
        catch (e) { void alertDialog(String(e), 'error') }
    }
}

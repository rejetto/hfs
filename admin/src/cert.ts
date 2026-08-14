import { createElement as h } from 'react'
import { t } from './i18n'
import { Box } from '@mui/material'
import { CardMembership } from '@mui/icons-material'
import { apiCall } from './api'
import { state } from './state'
import { alertDialog, newDialog } from './dialog'
import { InLink, LinkBtn, wikiLink } from './mui'

export function isCertError(error: any) {
    return /certificate/.test(error)
}

export function isKeyError(error: any) {
    return /private key/.test(error)
}

export async function suggestMakingCert(onSaved?: (saved: object) => void) {
    return new Promise(resolve => {
        const { close } = newDialog({
            icon: CardMembership,
            title: t`Get a certificate`,
            onClose: resolve,
            Content: () => h(Box, { sx: { p: 1, lineHeight: 1.5 } },
                h(Box, {}, t`HTTPS needs a certificate to work.`),
                h(Box, {}, t`We suggest you to `, h(InLink, { to: '/internet' }, t`get a free but proper certificate`), '.'),
                h(Box, {}, t`If you don't have a domain `, h(LinkBtn, { onClick: makeCertAndSave }, t`make a self-signed certificate`),
                    t` but that `, wikiLink('HTTPS#certificate', t` won't be perfect`), '.' ),
            )
        })

        async function makeCertAndSave() {
            if (!window.crypto.subtle)
                return alertDialog(t`Retry this procedure on localhost`, 'warning')
            try {
                const saved = await apiCall('make_self_signed_cert', { fileName: 'self' })
                Object.assign(state.config, saved)
                onSaved?.(saved)
                await alertDialog(t`Certificate saved`, 'success')
                close()
            }
            catch(e) {
                await alertDialog(e as Error)
            }
        }
    })
}

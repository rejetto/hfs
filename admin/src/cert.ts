import { createElement as h } from 'react'
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
            title: "Get a certificate",
            onClose: resolve,
            Content: () => h(Box, { sx: { p: 1, lineHeight: 1.5 } },
                h(Box, {}, "HTTPS needs a certificate to work."),
                h(Box, {}, "We suggest you to ", h(InLink, { to: '/internet' }, "get a free but proper certificate"), '.'),
                h(Box, {}, "If you don't have a domain ", h(LinkBtn, { onClick: makeCertAndSave }, "make a self-signed certificate"),
                    " but that ", wikiLink('HTTPS#certificate', " won't be perfect"), '.' ),
            )
        })

        async function makeCertAndSave() {
            if (!window.crypto.subtle)
                return alertDialog("Retry this procedure on localhost", 'warning')
            const saved = await apiCall('make_self_signed_cert', { fileName: 'self' })
            Object.assign(state.config, saved)
            onSaved?.(saved)
            await alertDialog("Certificate saved", 'success')
            close()
        }
    })
}

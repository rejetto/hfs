import { createElement as h } from 'react'
import { Box, Link, Typography } from '@mui/material'
import { useApi } from './api'
import { spinner } from './misc'

export default function HomePage() {
    const [res] = useApi('get_status')
    const { http, https } = res || {}
    const secure = !http?.active && https?.active ? 's' : ''
    const srv = secure ? https : (http?.active && http)
    const href = srv && `http${secure}://`+window.location.hostname + (srv.port === (secure ? 443 : 80) ? '' : ':'+srv.port)
    return h(Box, { flex: 1 },
        h(Typography, { variant: 'h4' },
            !res ? spinner()
                : href ? h(Link, { target:'frontend', href }, "Open frontend interface")
                : "Frontend switched off",
        )
    )
}

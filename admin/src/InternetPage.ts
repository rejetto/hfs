import { createElement as h } from 'react'
import { Box } from '@mui/material'
import { HomeWorkTwoTone, PublicTwoTone, RouterTwoTone } from '@mui/icons-material'
import { useApiEx } from './api'
import { with_ } from '@hfs/shared'
import { Flex } from './misc'

export default function InternetPage() {
    const { data: status } = useApiEx('get_status')
    const localColor = with_([status?.http?.error, status?.https?.error], ([h, s]) =>
        h && s ? 'error' : h || s ? 'warning' : 'success')
    const { data: nat } = useApiEx('get_nat')
    return h(Box, {},
        h(Box, { mb: 2 }, "This page helps you making your server work on the internet"),
        h(Flex, { justifyContent: 'space-around', alignItems: 'center', maxWidth: '40em' },
            h(Device, { name: "Local network", icon: HomeWorkTwoTone, color: localColor, ip: nat?.local_ip }),
            h(Sep),
            h(Device, { name: "Router", icon: RouterTwoTone, ip: nat?.gateway_ip }),
            h(Sep),
            h(Device, { name: "Internet", icon: PublicTwoTone, ip: nat?.public_ip }),
        ),
    )
}

function Sep() {
    return h(Box, { flex: 1, className: 'animated-dashed-line' })
}

function Device({ name, icon, color, ip }: any) {
    const fontSize = 'min(20vw, 10vh)'
    return h(Box, { display: 'inline-block', textAlign: 'center' },
        h(icon, { color, sx: { fontSize, mb: '-0.1em' } }),
        h(Box, { fontSize: 'larger' }, name),
        h(Box, { fontSize: 'smaller' }, ip || '…')
    )
}
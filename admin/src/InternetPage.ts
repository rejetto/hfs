import { createElement as h } from 'react'
import { Box, Button, Link } from '@mui/material'
import { HomeWorkTwoTone, PublicTwoTone, RouterTwoTone } from '@mui/icons-material'
import { apiCall, useApiEx } from './api'
import { closeDialog, with_ } from '@hfs/shared'
import { Flex } from './misc'
import { confirmDialog, promptDialog, toast, waitDialog } from './dialog'
import { NumberField } from '@hfs/mui-grid-form'
import md from './md'

export default function InternetPage() {
    const { data: status } = useApiEx('get_status')
    const localColor = with_([status?.http?.error, status?.https?.error], ([h, s]) =>
        h && s ? 'error' : h || s ? 'warning' : 'success')
    const { data: nat, reload } = useApiEx('get_nat')
    const port = nat?.port
    const wrongMap = nat?.mapped && nat.mapped.private.port !== port
    return h(Box, {},
        h(Box, { mb: 2 }, "This page helps you making your server work on the internet"),
        h(Flex, { justifyContent: 'space-around', alignItems: 'center', maxWidth: '40em' },
            h(Device, { name: "Local network", icon: HomeWorkTwoTone, color: localColor, ip: nat?.local_ip,
                below: port && h(Box, { fontSize: 'smaller' }, "port ", port),
            }),
            h(Sep),
            h(Device, {
                name: "Router", icon: RouterTwoTone, ip: nat?.gateway_ip,
                color: nat?.mapped && (wrongMap ? 'warning' : 'success'),
                below: h(Link, { fontSize: 'smaller', display: 'block', onClick: configure, sx: { cursor: 'pointer' } },
                    "port ", wrongMap ? 'is wrong' : nat?.mapped ? nat.mapped.public.port : "unknown"),
            }),
            h(Sep),
            h(Device, { name: "Internet", icon: PublicTwoTone, ip: nat?.public_ip }),
        ),
    )

    async function configure() {
        if (wrongMap) {
            if (!await confirmDialog(`There is a port mapping but it is pointing to the wrong port (${nat.mapped.private.port})`, { confirmText: "Fix it" })) return
            return mapPort(nat.mapped.public.port, "Map corrected")
        }
        const res = await promptDialog(md(`This will ask the router to map your port, so that it can be reached from the Internet.\nYou can set the same number of the local network (${port}), or a different one.`), {
            value: nat?.mapped?.public.port || port,
            field: { label: "Port seen from the Internet", comp: NumberField },
            addToBar: nat?.mapped && [h(Button, { color: 'warning', onClick: remove }, "Remove")],
            dialogProps: { sx: { maxWidth: '20em' } },
        })
        if (res)
            await mapPort(Number(res), "Port mapped")

        function remove() {
            closeDialog()
            mapPort(0, "Port removed")
        }

        async function mapPort(external: number, msg: string) {
            await apiCall('map_port', { external }, { modal: waitDialog })
            reload()
            toast(msg, 'success')
        }
    }
}

function Sep() {
    return h(Box, { flex: 1, className: 'animated-dashed-line' })
}

function Device({ name, icon, color, ip, below }: any) {
    const fontSize = 'min(20vw, 10vh)'
    return h(Box, { display: 'inline-block', textAlign: 'center' },
        h(icon, { color, sx: { fontSize, mb: '-0.1em' } }),
        h(Box, { fontSize: 'larger' }, name),
        h(Box, { fontSize: 'smaller' }, ip || '…'),
        below,
    )
}
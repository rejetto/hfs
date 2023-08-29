import { createElement as h, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, LinearProgress, Link } from '@mui/material'
import { HomeWorkTwoTone, PublicTwoTone, RouterTwoTone } from '@mui/icons-material'
import { apiCall, useApiEx } from './api'
import { closeDialog, with_ } from '@hfs/shared'
import { Flex, LinkBtn } from './misc'
import { alertDialog, confirmDialog, promptDialog, toast } from './dialog'
import { NumberField } from '@hfs/mui-grid-form'
import md from './md'
import { changeBaseUrl } from './FileForm'

const PORT_FORWARD_URL = 'https://portforward.com/'
const HIGHER_PORT = 1080
const MSG_ISP = `It is possible that your Internet Provider won't let you get incoming connections. Ask them if they sell "public IP" as an extra service.`

export default function InternetPage() {
    const [checkResult, setCheckResult] = useState<boolean | undefined>()
    const [checking, setChecking] = useState(false)
    const [mapping, setMapping] = useState(false)
    const [verifyAgain, setVerifyAgain] = useState(false)
    const { data: status, reload: reloadStatus } = useApiEx('get_status')
    const localColor = with_([status?.http?.error, status?.https?.error], ([h, s]) =>
        h && s ? 'error' : h || s ? 'warning' : 'success')
    const { data: nat, reload, error, loading } = useApiEx('get_nat')
    const port = nat?.internalPort
    const wrongMap = nat?.mapped && nat.mapped.private.port !== port
    const doubleNat = nat?.externalIp && nat.externalIp !== nat.publicIp
    useEffect(() => {
        if (!verifyAgain || !nat || loading) return
        setVerifyAgain(false)
        verify().then()
    }, [verifyAgain, nat, loading])
    return h(Flex, { vert: true },
        h(Alert, { severity: 'info' }, "This page helps you making your server work on the Internet"),
        baseUrlBox(),
        networkBox(),
    )

    function baseUrlBox() {
        if (!status) return h(CircularProgress)
        return h(Card, {}, h(CardContent, {},
            h(Box, { fontSize: 'x-large', mb: 2 }, "Address / Domain"),
            h(Flex, { flexWrap: 'wrap', alignItems: 'center' },
                status?.baseUrl || "Automatic, not configured",
                h(Button, {
                    size: 'small',
                    onClick() { changeBaseUrl().then(reloadStatus) }
                }, "Change"),
            )
        ))
    }

    function networkBox() {
        if (error) return "Error"
        if (!nat) return h(CircularProgress)
        return h(Flex, { justifyContent: 'space-around', alignItems: 'center', maxWidth: '40em' },
            h(Device, { name: "Local network", icon: HomeWorkTwoTone, color: localColor, ip: nat?.localIp,
                below: port && h(Box, { fontSize: 'smaller' }, "port ", port),
            }),
            h(Sep),
            h(Device, {
                name: "Router", icon: RouterTwoTone, ip: nat?.gatewayIp,
                color: nat?.mapped && (wrongMap ? 'warning' : 'success'),
                below: mapping ? h(LinearProgress, { sx: { height: '1em' } })
                    : h(LinkBtn, { fontSize: 'smaller', display: 'block', onClick: configure },
                        "port ", wrongMap ? 'is wrong' : nat?.mapped ? nat.mapped.public.port : "unknown"),
            }),
            h(Sep),
            h(Device, { name: "Internet", icon: PublicTwoTone, ip: nat?.publicIp,
                color: checkResult ? 'success' : checkResult === false ? 'error' : doubleNat ? 'warning' : undefined,
                below: checking ? h(LinearProgress, { sx: { height: '1em' } }) : h(Box, { fontSize: 'smaller' },
                    doubleNat && h(LinkBtn, { display: 'block', onClick: () => alertDialog(MSG_ISP, 'warning') }, "Double NAT"),
                    checkResult ? "Working!" : checkResult === false ? "Failed!" : '',
                    ' ',
                    nat?.publicIp && h(LinkBtn, { onClick: verify }, "Verify")
                )
            }),
        )
    }

    async function verify(): Promise<any> {
        setCheckResult(undefined)
        if (!await confirmDialog("This test will check if your server is working properly on the Internet")) return
        setChecking(true)
        try {
            const { success } = await apiCall('check_server', {})
            setCheckResult(success)
            if (success)
                return toast("Your server is responding correctly over the Internet", 'success')
            if (wrongMap)
                return fixPort().then(retry)
            if (doubleNat)
                return alertDialog(MSG_ISP, 'warning')
            const msg = "We couldn't reach your server from the Internet. "
            if (nat.upnp && !nat.mapped)
                return confirmDialog(msg + "Try port-forwarding on your router", { confirmText: "Fix it" }).then(go => {
                    if (go) mapPort(Math.max(nat.internalPort, HIGHER_PORT), "Port forwarded").then(retry)
                 })
            const { close } = alertDialog(h(Box, {}, msg + "Possible causes:", h('ul', {},
                !nat.upnp && h('li', {}, "Your router may need to be configured. ", h(Link, { href: PORT_FORWARD_URL, target: 'help' }, "How?")),
                h('li', {}, "There could be a firewall, try configuring or disabling it."),
                nat.mapped?.public.port <= 1024 && h('li', {},
                    "Your Internet Provider may be blocking ports under 1024. ",
                    h(Button, { size: 'small', onClick() { close(); mapPort(HIGHER_PORT).then(retry) } }, "Try " + HIGHER_PORT) ),
                nat.mapped && h('li', {}, "A bug in your modem/router, try rebooting it."),
                h('li', {}, MSG_ISP),
            )), 'warning')
        }
        catch(e: any) {
            alertDialog(e)
        }
        finally {
            setChecking(false)
        }

        function retry() {
            setVerifyAgain(true)
        }
    }

    async function configure() {
        if (wrongMap)
            return await confirmDialog(`There is a port-forwarding but it is pointing to the wrong port (${nat.mapped.private.port})`, { confirmText: "Fix it" })
                && fixPort()
        if (!nat?.upnp)
            return alertDialog(h(Box, { lineHeight: 1.5 }, md(`We cannot help you configuring your router because UPnP is not available.\nFind more help [on this website](${PORT_FORWARD_URL}).`)), 'info')
        const res = await promptDialog(md(`This will ask the router to map your port, so that it can be reached from the Internet.\nYou can set the same number of the local network (${port}), or a different one.`), {
            value: nat?.mapped?.public.port || port,
            field: { label: "Port seen from the Internet", comp: NumberField },
            addToBar: nat?.mapped && [h(Button, { color: 'warning', onClick: remove }, "Remove")],
            dialogProps: { sx: { maxWidth: '20em' } },
        })
        if (res)
            await mapPort(Number(res), "Port forwarded")

        function remove() {
            closeDialog()
            mapPort(0, "Port removed")
        }
    }

    function fixPort() {
        return mapPort(nat.mapped.public.port, "Forwarding corrected")
    }

    async function mapPort(external: number, msg='') {
        setMapping(true)
        try {
            await apiCall('map_port', { external })
            reload()
            if (msg) toast(msg, 'success')
        }
        catch {
            return alertDialog("Operation failed", 'error')
        }
        finally {
            setMapping(false)
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
        h(Box, { fontSize: 'smaller' }, ip || "unknown"),
        below,
    )
}
import { createElement as h, useEffect, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, Divider, LinearProgress, Link } from '@mui/material'
import { CardMembership, HomeWorkTwoTone, Lock, PublicTwoTone, RouterTwoTone, Send } from '@mui/icons-material'
import { apiCall, useApiEx } from './api'
import { closeDialog, DAY, formatTimestamp, GetNat, wantArray, with_ } from '@hfs/shared'
import { Flex, LinkBtn, manipulateConfig, isIP, Btn } from './misc'
import { alertDialog, confirmDialog, promptDialog, toast } from './dialog'
import { BoolField, Form, NumberField } from '@hfs/mui-grid-form'
import md from './md'
import { isCertError } from './OptionsPage'
import { changeBaseUrl } from './FileForm'

const PORT_FORWARD_URL = 'https://portforward.com/'
const HIGHER_PORT = 1080
const MSG_ISP = `It is possible that your Internet Provider won't let you get incoming connections. Ask them if they sell "public IP" as an extra service.`

export default function InternetPage() {
    const [checkResult, setCheckResult] = useState<boolean | undefined>()
    const [checking, setChecking] = useState(false)
    const [mapping, setMapping] = useState(false)
    const [verifyAgain, setVerifyAgain] = useState(false)
    const status = useApiEx('get_status')
    const localColor = with_([status.data?.http?.error, status.data?.https?.error], ([h, s]) =>
        h && s ? 'error' : h || s ? 'warning' : 'success')
    const { data: nat, reload: reloadNat, error, loading, element } = useApiEx<GetNat>('get_nat')
    const port = nat?.internalPort
    const wrongMap = nat?.mapped && nat.mapped.private.port !== port && nat.mapped.private.port
    const doubleNat = nat?.externalIp && nat?.publicIps && !nat.publicIps.includes(nat.externalIp)
    useEffect(() => {
        if (!verifyAgain || !nat || loading) return
        verify().then()
        setVerifyAgain(false)
    }, [verifyAgain, nat, loading])
    return h(Flex, { vert: true, gap: '2em', maxWidth: '40em' },
        h(Alert, { severity: 'info' }, "This page helps you making your server work on the Internet"),
        baseUrlBox(),
        networkBox(),
        httpsBox(),
    )

    function httpsBox() {
        const { error, listening } = status.data?.https ||{}
        const [values, setValues] = useState<any>()
        const cert = useApiEx('get_cert')
        useEffect(() => { apiCall('get_config', { only: ['acme_domain', 'acme_email', 'acme_renew'] }).then(setValues) } , [])
        if (!status || !values) return h(CircularProgress)
        return element || status.element || h(Card, {}, h(CardContent, {},
            h(Flex, { gap: '.5em', fontSize: 'x-large', mb: 1, alignItems: 'center' }, "HTTPS",
                h(Lock, { color: listening && !error ? 'success' : 'warning' }) ),
            h(Box, { mt: 1 },
                isCertError(error) && h(Alert, { severity: 'warning', sx: { mb: 1 } }, error),
                cert.element || with_(cert.data, c => h(Box, {}, h(CardMembership, { fontSize: 'small', sx: { mr: 1, verticalAlign: 'middle' } }), "Current certificate", h('ul', {},
                    h('li', {}, "Domain: ", c.subject?.CN || '-'),
                    h('li', {}, "Issuer: ", c.issuer?.O || h('i', {}, 'self-signed')),
                    h('li', {}, "Validity: ", ['validFrom', 'validTo'].map(k => formatTimestamp(c[k])).join(' – ')),
                ))),
                !listening && "Not enabled. " || error && "For HTTPS to work, you need a valid certificate.",
                h(Divider, { sx: { my: 2 } }),
                h(Form, {
                    gap: 1,
                    gridProps: {rowSpacing:1},
                    values,
                    set(v, k) {
                        setValues((was: any) => {
                            const values = { ...was, [k]: v }
                            apiCall('set_config', { values })
                            return values
                        })
                    },
                    fields: [
                        md("Generate certificate using [Let's Encrypt](https://letsencrypt.org)"),
                        { k: 'acme_domain', label: "Domain for certificate", sm: 6, required: true, helperText: "example: your.domain.com" },
                        { k: 'acme_email', label: "E-mail for certificate", sm: 6 },
                        { k: 'acme_renew', label: "Automatic renew one month before expiration", comp: BoolField, disabled: !values.acme_domain },
                    ],
                    save: {
                        children: "Request",
                        startIcon: h(Send),
                        async onClick() {
                            const domain = values.acme_domain
                            const fresh = domain === cert.data.subject?.CN && Number(new Date(cert.data.validTo)) - Date.now() >= 30 * DAY
                            if (fresh && !await confirmDialog("Your certificate is still good", { confirmText: "Make a new one anyway" }))
                                return
                            if (!await confirmDialog("HFS must temporarily serve HTTP on public port 80, and your router must be configured or this operation will fail")) return
                            await apiCall('make_cert', { domain, email: values.acme_email }, { timeout: 20_000 })
                                .then(async () => {
                                    await alertDialog("Certificate created", 'success')
                                    await manipulateConfig('https_port', async v => {
                                        return v < 0 && await confirmDialog("HTTPS is currently off", { confirmText: "Switch on" }) ? 443 : v
                                    })
                                    status.reload()
                                    cert.reload()
                                }, alertDialog)
                        }
                    },
                })
            )
        ))
    }

    function baseUrlBox() {
        const url = status.data?.baseUrl
        const hostname = url && new URL(url).hostname
        const domain = !isIP(hostname) && hostname
        return status.element || h(Card, {}, h(CardContent, {},
            h(Box, { fontSize: 'x-large', mb: 2 }, "Address / Domain"),
            h(Flex, { flexWrap: 'wrap', alignItems: 'center' },
                status.data?.baseUrl || "Automatic, not configured",
                h(Button, {
                    size: 'small',
                    onClick() { changeBaseUrl().then(status.reload) }
                }, "Change"),
                domain && h(Btn, {
                    size: 'small',
                    variant: 'outlined',
                    onClick: () => apiCall('check_domain', { domain })
                        .then(() => alertDialog("Domain seems ok", 'success'))
                }, "Check"),
            )
        ))
    }

    function networkBox() {
        if (error) return element
        if (!nat) return h(CircularProgress)
        return h(Flex, { justifyContent: 'space-around', alignItems: 'center' },
            h(Device, { name: "Local network", icon: HomeWorkTwoTone, color: localColor, ip: nat?.localIp,
                below: port && h(Box, { fontSize: 'smaller' }, "port ", port),
            }),
            h(Sep),
            h(Device, {
                name: "Router", icon: RouterTwoTone, ip: nat?.gatewayIp,
                color: nat?.mapped && (wrongMap ? 'warning' : 'success'),
                below: mapping ? h(LinearProgress, { sx: { height: '1em' } })
                    : h(LinkBtn, { fontSize: 'smaller', display: 'block', onClick: configure },
                        "port ", wrongMap ? 'is wrong' : nat?.externalPort || "unknown"),
            }),
            h(Sep),
            h(Device, { name: "Internet", icon: PublicTwoTone, ip: nat?.publicIps,
                color: checkResult ? 'success' : checkResult === false ? 'error' : doubleNat ? 'warning' : undefined,
                below: checking ? h(LinearProgress, { sx: { height: '1em' } }) : h(Box, { fontSize: 'smaller' },
                    doubleNat && h(LinkBtn, { display: 'block', onClick: () => alertDialog(MSG_ISP, 'warning') }, "Double NAT"),
                    checkResult ? "Working!" : checkResult === false ? "Failed!" : '',
                    ' ',
                    nat?.publicIps.length && nat.internalPort && h(LinkBtn, { onClick: verify }, "Verify")
                )
            }),
        )
    }

    async function verify(): Promise<any> {
        if (!nat) return // shut up ts
        setCheckResult(undefined)
        if (!verifyAgain && !await confirmDialog("This test will check if your server is working properly on the Internet")) return
        setChecking(true)
        try {
            const res = await apiCall('check_server', {})
            if (res.some((x: any) => x.success)) {
                setCheckResult(true)
                const specify = res.every((x: any) => x.success) ? '' : ` with address ${res.map((x: any) => x.ip).join(' + ')}`
                return toast("Your server is responding correctly over the Internet" + specify, 'success')
            }
            setCheckResult(false)
            if (wrongMap)
                return fixPort().then(retry)
            if (doubleNat)
                return alertDialog(MSG_ISP, 'warning')
            const msg = "We couldn't reach your server from the Internet. "
            if (nat.upnp && !nat.mapped)
                return confirmDialog(msg + "Try port-forwarding on your router", { confirmText: "Fix it" }).then(go => {
                    if (!go) return
                    try { mapPort(nat.internalPort!, '', '') }
                    catch { mapPort(HIGHER_PORT, '') }
                    toast("Port forwarded, now verify again", 'success')
                    retry()
                 })
            const { close } = alertDialog(h(Box, {}, msg + "Possible causes:", h('ul', {},
                !nat.upnp && h('li', {}, "Your router may need to be configured. ", h(Link, { href: PORT_FORWARD_URL, target: 'help' }, "How?")),
                h('li', {}, "There could be a firewall, try configuring or disabling it."),
                (nat.externalPort || nat.internalPort!) <= 1024 && h('li', {},
                    "Your Internet Provider may be blocking ports under 1024. ",
                    nat.upnp && h(Button, { size: 'small', onClick() { close(); mapPort(HIGHER_PORT).then(retry) } }, "Try " + HIGHER_PORT) ),
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
        if (!nat) return // shut up ts
        if (wrongMap)
            return await confirmDialog(`There is a port-forwarding but it is pointing to the wrong port (${wrongMap})`, { confirmText: "Fix it" })
                && fixPort()
        if (!nat.upnp)
            return alertDialog(h(Box, { lineHeight: 1.5 }, md(`We cannot help you configuring your router because UPnP is not available.\nFind more help [on this website](${PORT_FORWARD_URL}).`)), 'info')
        const res = await promptDialog(md(`This will ask the router to map your port, so that it can be reached from the Internet.\nYou can set the same number of the local network (${port}), or a different one.`), {
            value: nat.externalPort || port,
            field: { label: "Port seen from the Internet", comp: NumberField },
            addToBar: nat.mapped && [h(Button, { color: 'warning', onClick: remove }, "Remove")],
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
        if (!nat?.externalPort) return alertDialog("externalPort not found", 'error')
        return mapPort(nat.externalPort, "Forwarding corrected")
    }

    async function mapPort(external: number, msg='', errMsg="Operation failed") {
        setMapping(true)
        try {
            await apiCall('map_port', { external })
            reloadNat()
            if (msg) toast(msg, 'success')
        }
        catch(e) {
            if (errMsg) {
                const msg = errMsg + (external && Math.min(external, nat!.internalPort!) ? ". Some routers refuse to work with ports under 1024." : '')
                await alertDialog(msg, 'error')
            }
            throw e
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
        h(Box, { fontSize: 'smaller', whiteSpace: 'pre-wrap' }, wantArray(ip).join('\n') || "unknown"),
        below,
    )
}
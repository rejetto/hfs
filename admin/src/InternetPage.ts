import { createElement as h, ReactNode, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, CircularProgress, Divider, LinearProgress, Link } from '@mui/material'
import { CardMembership, HomeWorkTwoTone, Lock, Public, PublicTwoTone, RouterTwoTone, Send, Storage,
    SvgIconComponent } from '@mui/icons-material'
import { apiCall, useApiEx } from './api'
import { closeDialog, DAY, formatTimestamp, wait, wantArray, with_ } from '@hfs/shared'
import { PORT_DISABLED, Flex, LinkBtn, isIP, Btn, CFG } from './misc'
import { alertDialog, confirmDialog, promptDialog, toast, waitDialog } from './dialog'
import { BoolField, Form, MultiSelectField, NumberField, SelectField } from '@hfs/mui-grid-form'
import md from './md'
import { suggestMakingCert } from './OptionsPage'
import { changeBaseUrl } from './FileForm'
import { getNatInfo } from '../../src/nat'
import { ALL, WITH_IP } from './countries'
import _ from 'lodash'
import { SvgIconProps } from '@mui/material/SvgIcon/SvgIcon'
import { ConfigForm } from './ConfigForm'

const COUNTRIES = ALL.filter(x => WITH_IP.includes(x.code))

const PORT_FORWARD_URL = 'https://portforward.com/'
const HIGHER_PORT = 1080
const MSG_ISP = `It is possible that your Internet Provider won't let you get incoming connections. Ask them if they sell "public IP" as an extra service.`

export default function InternetPage() {
    const [checkResult, setCheckResult] = useState<boolean | undefined>()
    const [checking, setChecking] = useState(false)
    const [mapping, setMapping] = useState(false)
    const [verifyAgain, setVerifyAgain] = useState(false)
    const status = useApiEx('get_status')
    const config = useApiEx('get_config', { only: ['base_url'] })
    const localColor = with_([status.data?.http?.error, status.data?.https?.error], ([h, s]) =>
        h && s ? 'error' : h || s ? 'warning' : 'success')
    type GetNat = Awaited<ReturnType<typeof getNatInfo>>
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
        h(Alert, { severity: 'info' }, "This page makes sure your site is working correctly on the Internet"),
        baseUrlBox(),
        networkBox(),
        httpsBox(),
        geoBox(),
    )

    function geoBox() {
        const countryOptions = useMemo(() => _.sortBy(COUNTRIES, 'name').map(x => ({
            value: x.code,
            label: `${x.flag} ${x.name}`
        })), [COUNTRIES])
        return h(TitleCard, { title: "Geo IP", icon: Public },
            h(ConfigForm<{
                [CFG.geo_enable]: boolean
                [CFG.geo_allow]: null | boolean
                [CFG.geo_list]: string[]
                [CFG.geo_allow_unknown]: boolean
            }>, {
                keys: [ CFG.geo_enable, CFG.geo_allow, CFG.geo_list, CFG.geo_allow_unknown ],
                form: values => ({ fields: [
                    { k: CFG.geo_enable, comp: BoolField, label: "Enable", helperText: "Necessary database will be downloaded every month (2MB)" },
                    ...!values[CFG.geo_enable] ? [] : [
                        {
                            k: CFG.geo_allow,
                            comp: SelectField,
                            label: "Rule",
                            options: { "no restriction": null, "block selected countries": false, "allow selected countries": true },
                        },
                        values[CFG.geo_allow] != null && {
                            k: CFG.geo_list,
                            comp: MultiSelectField<string>,
                            label: `Selected countries (${values[CFG.geo_list]?.length || 0})`,
                            placeholder: "none",
                            options: countryOptions,
                            clearable: true,
                        },
                        values[CFG.geo_allow] != null && {
                            k: CFG.geo_allow_unknown,
                            comp: SelectField,
                            label: "When country cannot be determined",
                            options: { Allow: true, Block: false },
                        },
                    ]
                ] })
            })
        )
    }

    function httpsBox() {
        const [values, setValues] = useState<any>()
        const cert = useApiEx('get_cert')
        useEffect(() => { apiCall('get_config', { only: ['acme_domain', 'acme_email', 'acme_renew'] }).then(setValues) } , [])
        if (!status || !values) return h(CircularProgress)
        const { https } = status.data ||{}
        const disabled = https?.port === PORT_DISABLED
        const error = https?.error
        return element || status.element || h(TitleCard, { title: "HTTPS", icon: Lock, color: https?.listening && !error ? 'success' : 'warning' },
            error ? h(Alert, { severity: 'warning' }, error) :
                (disabled && h(LinkBtn, { onClick: notEnabled }, "Not enabled")),
            cert.element || with_(cert.data, c => c.none ? h(LinkBtn, { onClick: () => suggestMakingCert().then(cert.reload) }, "No certificate configured") : h(Box, {},
                h(CardMembership, { fontSize: 'small', sx: { mr: 1, verticalAlign: 'middle' } }), "Current certificate",
                h('ul', {},
                    h('li', {}, "Domain: ", c.altNames?.join(' + ') ||'-'),
                    h('li', {}, "Issuer: ", c.issuer?.O || h('i', {}, 'self-signed')),
                    h('li', {}, "Validity: ", ['validFrom', 'validTo'].map(k => formatTimestamp(c[k])).join(' – ')),
                )
            )),
            h(Divider),
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
                    { k: 'acme_domain', label: "Domain for certificate", sm: 6, required: true, helperText: md("Example: your.domain.com\nMultiple domains separated by commas") },
                    { k: 'acme_email', label: "E-mail for certificate", sm: 6 },
                    { k: 'acme_renew', label: "Automatic renew one month before expiration", comp: BoolField, disabled: !values.acme_domain },
                ],
                save: {
                    children: "Request",
                    startIcon: h(Send),
                    async onClick() {
                        const [domain, ...altNames] = values.acme_domain.split(',')
                        const fresh = domain === cert.data.subject?.CN && Number(new Date(cert.data.validTo)) - Date.now() >= 30 * DAY
                        if (fresh && !await confirmDialog("Your certificate is still good", { confirmText: "Make a new one anyway" }))
                            return
                        if (!await confirmDialog("HFS must temporarily serve HTTP on public port 80, and your router must be configured or this operation will fail")) return
                        const res = await apiCall('check_domain', { domain }).catch(e =>
                            confirmDialog(String(e), { confirmText: "Continue anyway" }) )
                        if (res === false) return
                        await apiCall('make_cert', { domain, altNames, email: values.acme_email }, { timeout: 20_000 })
                            .then(async () => {
                                await alertDialog("Certificate created", 'success')
                                if (disabled)
                                    await notEnabled()
                                cert.reload()
                            }, alertDialog)
                    }
                },
            })
        )
    }

    async function notEnabled() {
        if (!await confirmDialog("HTTPS is currently disabled.\nFull configuration is available in the Options page.", { confirmText: "Enable it"})) return
        const stop = waitDialog()
        try {
            await apiCall('set_config', { values: { https_port: 443 } })
            await wait(1000)
            status.reload()
        }
        finally { stop() }
    }

    function baseUrlBox() {
        const url = config.data?.base_url
        const hostname = url && new URL(url).hostname
        const domain = !isIP(hostname) && hostname
        return config.element || h(TitleCard, { icon: Public, title: "Address / Domain" },
            h(Flex, { flexWrap: 'wrap' },
                url || "Automatic, not configured",
                h(Flex, {}, // keep buttons together when wrapping
                    h(Btn, {
                        size: 'small',
                        variant: 'outlined',
                        onClick: () => void(changeBaseUrl().then(config.reload))
                    }, "Change"),
                    domain && h(Btn, {
                        size: 'small',
                        variant: 'outlined',
                        onClick: () => apiCall('check_domain', { domain })
                            .then(() => alertDialog("Domain seems ok", 'success'))
                    }, "Check"),
                ),
            ),
            h(ConfigForm<{ force_base_url: boolean }>, {
                keys: ['force_base_url'],
                saveOnChange: true,
                form: {
                    fields: [
                        { k: 'force_base_url', comp: BoolField, label: "Accept requests only using domain (and localhost)" }
                    ]
                },
            })
        )
    }

    function networkBox() {
        if (error) return element
        if (!nat) return h(CircularProgress)
        const direct = nat?.publicIps.includes(nat?.localIp)
        return h(Flex, { justifyContent: 'space-around' },
            h(Device, { name: "Server", icon: direct ? Storage : HomeWorkTwoTone, color: localColor, ip: nat?.localIp,
                below: port && h(Box, { fontSize: 'smaller' }, "port ", port),
            }),
            !direct && h(Sep),
            !direct && h(Device, {
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
                    nat?.publicIps.length > 0 && nat.internalPort && h(LinkBtn, { onClick: verify }, "Verify")
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
            const url = config.data?.base_url
            const urlResult = url && await apiCall('self_check', { url }).catch(() =>
                alertDialog(md(`Sorry, we couldn't verify your configured address ${url} 😰\nstill, we are going to test your IP address 🤞`), 'warning'))
            if (urlResult?.success) {
                setCheckResult(true)
                return alertDialog(h(Box, {}, "Your server is responding correctly over the Internet:",
                    h('ul', {}, h('li', {}, urlResult.url))), 'success')
            }
            if (urlResult?.success === false)
                await alertDialog(md(`Your configured address ${url} doesn't seem to work 😰\nstill, we are going to test your IP address 🤞`), 'warning')
            const res = await apiCall('self_check', {})
            if (res.some((x: any) => x.success)) {
                setCheckResult(true)
                const mild = urlResult.success === false && md(`Your server is responding over the Internet 👍\nbut not with configured address ${url} 👎\njust on your IP:`)
                return alertDialog(h(Box, {}, mild || "Your server is responding correctly over the Internet:",
                    h('ul', {}, ...res.map((x: any) => h('li', {}, x.url)))), mild ? 'warning' : 'success')
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
            const cfg = await apiCall('get_config', { only: [CFG.geo_enable, CFG.geo_allow] })
            const { close } = alertDialog(h(Box, {}, msg + "Possible causes:", h('ul', {},
                cfg[CFG.geo_enable] && cfg[CFG.geo_allow] != null && h('li', {}, "You may be blocking a country from where the test is performed"),
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
            setCheckResult(undefined) // things have changed, invalidate check result
        }
        catch(e) {
            if (errMsg) {
                const low = external && Math.min(external, nat!.internalPort!) < 1024
                const msg = errMsg + (low ? ". Some routers refuse to work with ports under 1024." : '')
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

function TitleCard({ title, icon, color, children }: { title: ReactNode, icon?: SvgIconComponent, color?: SvgIconProps['color'], children?: ReactNode }) {
    return h(Card, {}, h(CardContent, {}, h(Flex, { vert: true },
        h(Box, { fontSize: 'x-large' }, icon && h(icon, { color, sx: { mr: 1, verticalAlign: 'bottom', mb: '2px' } }), title),
        children
    )))
}

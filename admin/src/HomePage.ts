// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { t } from './i18n'

import { createElement as h, ReactNode, useState } from 'react'
import { Box, Card, CardContent, Checkbox, FormControlLabel, Link } from '@mui/material'
import { apiCall, useApiEx, useApiList } from './api'
import {
    dontBotherWithKeys, onlyTruthy, REPO_URL, md,
    replaceStringToReact, wait, with_, DAY, HOUR, PREVIOUS_TAG, PLUGIN_USAGE_URL
} from './misc'
import { Btn, Flex, InLink, LinkBtn, wikiLink, } from './mui'
import {
    BrowserUpdated as UpdateIcon, CheckCircle, Colorize, Error, Info, OpenInNew, Restore, Warning
} from '@mui/icons-material'
import { state, useSnapState } from './state'
import { alertDialog, confirmDialog, promptDialog, toast } from './dialog'
import { isCertError, isKeyError, suggestMakingCert } from './cert'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { SwitchThemeBtn } from './theme'
import { CheckboxField } from '@hfs/mui-grid-form'
import { ConfigForm } from './ConfigForm'
import { Release } from '../../src/update'
import { adminApis } from '../../src/adminApis'
import { RandomPlugin } from './RandomPlugin'

export default function HomePage() {
    const SOLUTION_SEP = " — "
    const { username } = useSnapState()
    const { data: status, reload: reloadStatus, element: statusEl } = useApiEx<typeof adminApis.get_status>('get_status')
    const { data: account } = useApiEx<typeof adminApis.get_account>(username && 'get_account')
    const cfg = useApiEx('get_config', { only: ['https_port', 'cert', 'private_key', 'proxies', 'ignore_proxies', 'vfs', 'split_uploads', 'share_usage_stats'] })
    const { list: plugins } = useApiList('get_plugins')
    const [checkPlugins, setCheckPlugins] = useState(false)
    const { list: pluginUpdates} = useApiList(checkPlugins && 'get_plugin_updates')
    const [updates, setUpdates] = useState<undefined | Release[]>()
    const [otherVersions, setOtherVersions] = useState<undefined | Release[]>()
    const [usageStatsFeedback, setUsageStatsFeedback] = useState<boolean>()
    const shareUsage = Boolean(cfg.data?.share_usage_stats)
    if (statusEl || !status) // !status here to shut up ts
        return statusEl
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const serverErrors = _.mapValues({ http, https }, v =>
        v.busy ? [
            t('port_already_in_use', { configuredPort: v.configuredPort, process: v.busy }),
            SOLUTION_SEP, cfgLink('use_different_port'),
            t('or_stop_process', { process: v.busy }),
        ]
            : v.error )
    const errors = serverErrors && onlyTruthy(Object.entries(serverErrors).map(([k,v]) =>
        v && [md(t("Protocol <u>{k}</u>: ", { k: k })), v,
                    (isCertError(v) || isKeyError(v)) && [
                SOLUTION_SEP, h(LinkBtn, {
                    onClick() { suggestMakingCert().then(() => wait(999)).then(cfg.reload).then(reloadStatus) } },
                    t`make one`
                ), t` or `, SOLUTION_SEP, cfgLink('provide_adequate_files')
            ]]))
    const rightClickToInstallFromUrl = {
        async onContextMenu(ev: any) {
            ev.preventDefault()
            if (!status.updatePossible)
                return alertDialog(t`update_not_supported`, 'warning')
            const res = await promptDialog(t`Enter a link to the zip to install`)
            if (res)
                await update(res)
        },
        title: status.updatePossible && t`Right-click if you want to install a zip`,
    }
    const vfs = cfg.data?.vfs
    return h(Box, {},
        h(RandomPlugin),
        h(Box, { sx: { display:'flex', gap: 2, flexDirection:'column', alignItems: 'flex-start', height: '100%' } },
            dontBotherWithKeys(status.alerts?.map(x => entry('warning', md(x, { html: false }))) || []),
            errors.length ? dontBotherWithKeys(errors.map(msg => entry('error', dontBotherWithKeys(msg))))
                : entry('success', t`Server is working`),
            vfs && !vfs.children?.length && !vfs.source ? entry('warning', t`You have no shared files`, SOLUTION_SEP, fsLink('add some')) : null,
            account?.adminActualAccess ? entry('', t("Welcome, {username}", { username: username }))
                : entry('', md(t`localhost_admin_access_notice`),
                    ...status.anyAccountCanLoginAdmin ? [] : [SOLUTION_SEP, t`to access from another computer, you must `, h(InLink, { to:'/accounts' }, md(t`create an account with *admin* permission`))] ),
            !href && entry('warning', t`Frontend unreachable: `,
                _.map(serverErrors, (v,k) => k + " " + t(v ? "is in error" : "is off")).join(', '),
                !errors.length && [ SOLUTION_SEP, cfgLink('switch_http_or_https_on') ]
            ),
            with_(status.acmeRenewError, x => x && entry('warning', x)),
            with_(status.blacklistedInstalledPlugins, x => x?.length > 0
                && entry('warning', t('blacklisted_plugins', { n: x.length, list: x.join(', ') })) ),
            with_(plugins?.filter(x => x.error || x.badApi).length, x => x > 0
                && entry('warning', t('plugins_failing', { n: x }), SOLUTION_SEP, h(InLink, { to:'/plugins' }, t`check now`))),
            !cfg.data?.split_uploads && (Date.now() - +new Date(status.cloudflareDetected || 0)) < DAY
                && entry('', wikiLink('Reverse-proxy#cloudflare', t`Cloudflare detected, read our guide`)),
            with_(proxyWarning(cfg.data, status), x => x && entry('warning', x,
                    SOLUTION_SEP, cfgLink('set_number_of_proxies'),
                    SOLUTION_SEP, t`unless you are sure and you can `, h(Btn, {
                        variant: 'outlined',
                        size: 'small',
                        sx: { lineHeight: 'unset' }, // fit in the line, avoiding bad layout
                        confirm: t`Go on only if you know what you are doing`,
                        onClick: () => apiCall('set_config', { values: { ignore_proxies: true } }).then(cfg.reload)
                    }, t`ignore this warning`),
                    SOLUTION_SEP, wikiLink('Proxy-warning', t`Explanation`)
            )),
            (cfg.data?.proxies > 0 || status?.proxyDetected) && entry('', wikiLink('Reverse-proxy', t`Read our guide on proxies`)),
            status.frpDetected && entry('warning', t`frp_tcp_warning`,
                h('ol',{},
                    h('li',{}, t`frp_http_solution`),
                    h('li',{}, md(t`frp_non_localhost_solution`)),
                    h('li',{}, t`frp_disable_localhost_admin_solution`),
                )),
            entry('', md(t`admin_panel_intro`)),
            entry('', wikiLink('', t`See the documentation`), t` and `, h(Link, { target: 'support', href: REPO_URL + 'discussions' }, t`get support`)),
            !updates && with_(status.autoCheckUpdateResult, x =>
                x?.isNewer && h(Update, { info: x, fromAuto: true, disabled: !status.updatePossible, bodyCollapsed: true, title: t`An update has been found` }) ),
            pluginUpdates.length > 0 && entry('success', t('plugin_updates_available', {
                n: pluginUpdates.length,
                list: pluginUpdates.map(p => p.id).join(', '),
            })),
            h(ConfigForm, {
                // MUI 7 folded Grid2 into Grid, so the generated class name changed with the import path.
                gridProps: { sx: { mt: 1, display: 'flex', columnGap: 1, alignitems: 'center', '&>div.MuiGrid-root': { width: 'auto', px: .5, py: 0 }, '.MuiCheckbox-root': { pl: '2px' } } },
                saveOnChange: true,
                form: {
                    fields: [
                        status.updatePossible === 'local' ? h(Btn, { icon: UpdateIcon, onClick: () => update() }, t`Update from local file`)
                            : !updates && h(Btn, {
                                icon: UpdateIcon,
                                onClick() {
                                    apiCall('wait_project_info').then(reloadStatus)
                                    setCheckPlugins(true) // this only happens once, actually (until you change page)
                                    return apiCall<typeof adminApis.check_update>('check_update').then(x => setUpdates(x.options), alertDialog)
                                },
                                ...rightClickToInstallFromUrl
                            }, t`Check for updates`),
                        { k: 'auto_check_update', comp: CheckboxField, label: t`Auto check updates daily` },
                        { k: 'update_to_beta', comp: CheckboxField, label: t`Include beta versions` },
                    ]
                }
            }),
            updates && with_(_.find(updates, 'isNewer'), newer =>
                !updates.length || !status.updatePossible && !newer ? entry('', t`No update available`)
                    : newer && !status.updatePossible ? entry('success', t("Version {name} available", { name: newer.name }))
                        : h(Flex, { vert: true },
                            updates.map((x: any) => h(Update, { info: x, key: x.name })) ),
            ),
            h(Flex, { flexWrap: 'wrap' },
                !otherVersions && status.updatePossible && status.previousVersionAvailable
                    && h(Btn, { icon: Restore, onClick: () => update(PREVIOUS_TAG) }, t`Reinstall previous version`),
                !status.updatePossible ? entry('', h(Link, { href: REPO_URL + 'releases/', target: 'repo' }, t`All releases`))
                    : !otherVersions ? h(Btn, { icon: Colorize, onClick: getOtherVersions, ...rightClickToInstallFromUrl }, t`Get another version`)
                        : h(Flex, { vert: true }, otherVersions.map((x: any) => h(Update, {
                            info: x,
                            key: x.name,
                            bodyCollapsed: true
                        }))),
            ),
            h(SwitchThemeBtn),
            h(FormControlLabel, {
                label: h(Box, { sx: { fontSize: 'large' } }, t`usage_stats_cta`,
                    SOLUTION_SEP,
                    h(Link, { href: '#', onClick(ev) {
                        ev.stopPropagation()
                        ev.preventDefault()
                        showUsageStatsInfo()
                    } }, t`how it helps`)
                ),
                control: h(Box, { sx: { position: 'relative', display: 'inline-flex' } },
                    h(Checkbox, {
                        checked: shareUsage,
                        onChange(ev) {
                            const v = ev.target.checked
                            apiCall('set_config', { values: { share_usage_stats: v } })
                                .then(() => {
                                    setUsageStatsFeedback(v)
                                    return cfg.reload()
                                }, alertDialog)
                        }
                    }),
                    usageStatsFeedback !== undefined && h('span', {
                        'aria-hidden': true,
                        className: usageStatsFeedback ? 'usage-stats-celebrate' : undefined,
                        style: {
                            position: 'absolute', bottom: '-1em', right: '-1em', pointerEvents: 'none', fontSize: '2em', lineHeight: 1,
                            transformOrigin: '70% 80%',
                            animation: usageStatsFeedback ? 'celebrate 1s ease-out' : 'wave .18s 5 alternate ease-in-out',
                        },
                        onAnimationEnd: () => setUsageStatsFeedback(undefined),
                    }, usageStatsFeedback ? '🎉' : '👋')
                )
            }),
            Date.now() - Number(new Date(status.started)) > HOUR && h(Link, {
                title: t`Donate`,
                target: 'donate',
                style: { textDecoration: 'none', position: 'fixed', bottom: 0, right: 4, fontSize: 'large' },
                href: 'https://www.paypal.com/donate/?hosted_button_id=HC8MB4GRVU5T2'
            }, '❤️')
        )
    )

    async function getOtherVersions() {
        return apiCall<typeof adminApis.get_other_versions>('get_other_versions')
            .then(x => setOtherVersions(x.options), alertDialog)
    }

    function showUsageStatsInfo() {
        alertDialog(h(Box, { sx: { alignSelf: 'stretch', '& > :first-child': { mt: 0 } } }, // the dialog padding is enough
            h('p', {}, h('b', {}, t`usage_stats_no_personal_data`)),
            h('p', {}, t`usage_stats_explanation_1`),
            h('p', {}, t`usage_stats_explanation_2`),
            h('details', {},
                h('summary', {}, t`Details`),
                h('p', {}, t`What is sent:`),
                h(Box, { sx: { overflow: 'auto', p: 1, bgcolor: 'action.hover', whiteSpace: 'pre' } },
`{
  "uuid": "random installation UUID",
  "hfsVersion": "${status?.version}",
  "plugins": [
    {
      "repo": "GitHub address",
      "version": 1,
      "enabled": true
    }
  ]
}`),
                h('p', {}, t`usage_stats_disable_warning`),
                h(Link, { href: PLUGIN_USAGE_URL, target: 'plugin-stats' }, t`See public statistics`),
        ),
        ), { title: t`Anonymous statistics` })
    }

}
function Update({ info, title, bodyCollapsed, fromAuto, disabled }: { title?: ReactNode, info: Release, bodyCollapsed?: boolean, fromAuto?: true, disabled?: boolean }) {
    const [collapsed, setCollapsed] = useState(bodyCollapsed)
    return h(Flex, { alignItems: 'flex-start', flexWrap: 'wrap' },
        h(Card, { className: 'release' }, h(CardContent, {},
            h(Flex, {},
                title && h(Box, { sx: { fontSize: 'larger', mb: 1 } }, title),
                h(Btn, {
                    icon: UpdateIcon,
                    disabled,
                    ...!info.isNewer && info.prerelease && { color: 'warning', variant: 'outlined' },
                    onClick: () => update(fromAuto ? undefined : info.tag_name) // in case of autoCheck, don't specify the tag_name, as it may have been retired in the meantime (in favor of a newer one)
                }, t`Install ` + info.name + (info.isNewer ? '' : t` (older)`)),
                h(Link, { href: REPO_URL + 'releases/tag/' + info.tag_name, target: 'repo' }, h(OpenInNew)),
            ),
            collapsed ? h(LinkBtn, { sx: { display: 'block', mt: 1 }, onClick(){ setCollapsed(false) } }, t`See details`)
                : h(Box, { sx: { mt: 1 } }, renderChangelog(info.body))
        )),
    )
}

function renderChangelog(s: string) {
    return md(s, {
        onText: s => replaceStringToReact(s, /(?<=^|\W)#(\d+)\b|(https:.*\S+)/g, m =>  // link issues and urls
            m[1] ? h(Link, { href: REPO_URL + 'issues/' + m[1], target: '_blank' }, h(OpenInNew, { fontSize: 'small' }) )
                : h(Link, { href: m[2], target: '_blank' }, m[2] )
        )
    })
}

async function update(tag?: string) {
    if (!await confirmDialog(t`update_install_duration_warning`)) return
    let d = toast(t`Downloading`)
    const err = await apiCall('update', { tag }, { timeout: 600 /*download can be lengthy*/ })
        .then(() => 0, e => e)
    if (err)
        return alertDialog(err)
    d.close()
    d = toast(t`Restarting`)
    const restarting = Date.now()
    let warning: undefined | ReturnType<typeof alertDialog>
    do {
        if (!warning && Date.now() - restarting > 15_000)
            warning = alertDialog(t`This is taking too long, please check your server`, 'warning')
        await wait(500) // give the old server time to stop responding before the first probe
    } while (await apiCall('NONE').then(() => 0, e => !e.code)) // while we get no response
    warning?.close()
    // the server is back on, SSE is restored and login dialog may appear, unwanted because we are just waiting to reload
    subscribeKey(state, 'loginRequired', () => state.loginRequired = false)
    d.close()
    await alertDialog(t`Procedure complete`, 'success')
    window.location.reload() // show new gui
}

type Color = '' | 'success' | 'warning' | 'error'

function entry(color: Color, ...content: ReactNode[]) {
    return h(Box, {
            sx: { fontSize: 'x-large', color: th => color && th.palette[color]?.main },
        },
        h(({ success: CheckCircle, info: Info, '': Info, warning: Warning, error: Error })[color], {
            sx: { mr: 1, color: color ? undefined : 'primary.main' }
        }),
        h('span', { style: ['warning', 'error'].includes(color) ? { animation: '.5s blink 2' } : undefined },
            ...content)
    )
}

function fsLink(key='file_system_page') {
    return h(InLink, { to:'/fs' }, t(key))
}

function cfgLink(key='options_page') {
    return h(InLink, { to: '/options' }, t(key))
}

export function proxyWarning(cfg: any, status: any) {
    return status && cfg && !cfg.ignore_proxies && (!cfg.proxies && status.proxyDetected ? t`A proxy was detected but none is configured`
        : cfg.proxies && !status.proxyDetected && (Date.now() - +new Date(status.started) > DAY) ? t('configured_proxies_not_detected', { proxyCount: cfg.proxies })
        : '')
}

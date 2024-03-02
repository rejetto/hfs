// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useState } from 'react'
import { Box, Card, CardContent, LinearProgress, Link } from '@mui/material'
import { apiCall, useApiEx, useApiList } from './api'
import { dontBotherWithKeys, objSameKeys, onlyTruthy, prefix, REPO_URL,
    wait, with_ } from './misc'
import { Btn, Flex, InLink, LinkBtn, wikiLink, } from './mui'
import { BrowserUpdated as UpdateIcon, CheckCircle, Error, Info, Launch, OpenInNew, Warning } from '@mui/icons-material'
import md, { replaceStringToReact } from './md'
import { state, useSnapState } from './state'
import { alertDialog, confirmDialog, promptDialog, toast } from './dialog'
import { isCertError, isKeyError, suggestMakingCert } from './OptionsPage'
import { VfsNode } from './VfsPage'
import { Account } from './AccountsPage'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'

interface ServerStatus { listening: boolean, port: number, error?: string, busy?: string }

interface Status {
    http: ServerStatus
    https: ServerStatus
    frpDetected: boolean
    proxyDetected?: boolean
    updatePossible: boolean | string
    version: string
}

export default function HomePage() {
    const SOLUTION_SEP = " — "
    const { username } = useSnapState()
    const { data: status, reload: reloadStatus, element: statusEl } = useApiEx<Status>('get_status')
    const { data: vfs } = useApiEx<{ root?: VfsNode }>('get_vfs')
    const { data: account } = useApiEx<Account>(username && 'get_account')
    const cfg = useApiEx('get_config', { only: ['https_port', 'cert', 'private_key', 'proxies', 'update_to_beta'] })
    const { list: plugins } = useApiList('get_plugins')
    const [checkPlugins, setCheckPlugins] = useState(false)
    const { list: pluginUpdates} = useApiList(checkPlugins && 'get_plugin_updates')
    const [updates, setUpdates] = useState<undefined | any[]>()
    if (statusEl || !status)
        return statusEl
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const serverStatus = _.pick(status, ['http', 'https'])
    const serverErrors = objSameKeys(serverStatus, v =>
        v.busy ? [`port ${v.port} already used by ${v.busy}${SOLUTION_SEP}choose a `, cfgLink('different port'), ` or stop ${v.busy}`]
            : v.error )
    const errors = serverErrors && onlyTruthy(Object.entries(serverErrors).map(([k,v]) =>
        v && [md(`Protocol <u>${k}</u> cannot work: `), v,
            (isCertError(v) || isKeyError(v)) && [
                SOLUTION_SEP, h(LinkBtn, {
                    onClick() { suggestMakingCert().then(() => wait(999)).then(cfg.reload).then(reloadStatus) } },
                    "make one"
                ), " or ", SOLUTION_SEP, cfgLink("provide adequate files")
            ]]))
    return h(Box, { display:'flex', gap: 2, flexDirection:'column', alignItems: 'flex-start', height: '100%' },
        username && entry('', "Welcome "+username),
        errors.length ? dontBotherWithKeys(errors.map(msg => entry('error', dontBotherWithKeys(msg))))
            : entry('success', "Server is working"),
        !vfs ? h(LinearProgress)
            : !vfs.root?.children?.length && !vfs.root?.source ? entry('warning', "You have no files shared", SOLUTION_SEP, fsLink("add some"))
                : entry('', md("This is the Admin-panel, where you manage your server. Access your files on "),
                    h(Link, { target:'frontend', href: '../..' }, "Front-end", h(Launch, { sx: { verticalAlign: 'sub', ml: '.2em' } }))),
        !href && entry('warning', "Frontend unreachable: ",
            _.map(serverErrors, (v,k) => k + " " + (v ? "is in error" : "is off")).join(', '),
            !errors.length && [ SOLUTION_SEP, cfgLink("switch http or https on") ]
        ),
        plugins.find(x => x.badApi) && entry('warning', "Some plugins may be incompatible"),
        !account?.adminActualAccess && entry('', md("On <u>localhost</u> you don't need to login"),
            SOLUTION_SEP, "to access Admin-panel from another computer ", h(InLink, { to:'accounts' }, md("create an account with *admin* permission")) ),
        with_(proxyWarning(cfg, status), x => x && entry('warning', x,
                SOLUTION_SEP, cfgLink("set the number of proxies"),
                SOLUTION_SEP, "unless you are sure and you can ", h(Btn, {
                    variant: 'outlined',
                    size: 'small',
                    sx: { lineHeight: 'unset' }, // fit in the line, avoiding bad layout
                    confirm: "Go on only if you know what you are doing",
                    onClick: () => apiCall('set_config', { values: { ignore_proxies: true } }).then(cfg.reload)
                }, "ignore this warning"),
                SOLUTION_SEP, wikiLink('Proxy-warning', "Explanation")
        )),
        (cfg.data?.proxies > 0 || status?.proxyDetected) && entry('', wikiLink('Reverse-proxy', "Read our guide on proxies")),
        status.frpDetected && entry('warning', `FRP is detected. It should not be used with "type = tcp" with HFS. Possible solutions are`,
            h('ol',{},
                h('li',{}, `configure FRP with type=http (best solution)`),
                h('li',{}, md(`configure FRP to connect to HFS <u>not</u> with 127.0.0.1 (safe, but you won't see users' IPs)`)),
                h('li',{}, `disable "admin access for localhost" in HFS (safe, but you won't see users' IPs)`),
            )),
        entry('', wikiLink('', "See the documentation"), " and ", h(Link, { target: 'support', href: REPO_URL + 'discussions' }, "get support")),
        pluginUpdates.length > 0 && entry('success', "Updates available for plugin(s): " + pluginUpdates.map(p => p.id).join(', ')),
        status.updatePossible === 'local' ? h(Btn, {
                icon: UpdateIcon,
                onClick: () => update()
            }, "Update from local file")
            : !updates ? h(Btn, {
                variant: 'outlined',
                icon: UpdateIcon,
                onClick() {
                    setCheckPlugins(true)
                    return apiCall('check_update').then(x => setUpdates(x.options), alertDialog)
                },
                async onContextMenu(ev) {
                    ev.preventDefault()
                    if (!status.updatePossible)
                        return alertDialog("Automatic update is only for binary versions", 'warning')
                    const res = await promptDialog("Enter a link to the zip to install")
                    if (res)
                        await update(res)
                },
                title: status.updatePossible && "Right-click if you want to install a zip",
            }, "Check for updates")
            : with_(_.find(updates, 'isNewer'), newer =>
                !updates.length || !status.updatePossible && !newer ? entry('', "No update available")
                    : newer && !status.updatePossible ? entry('success', `Version ${newer.name} available`)
                        : h(Flex, { vert: true },
                            updates.map((x: any) =>
                                h(Flex, { key: x.name, alignItems: 'flex-start', flexWrap: 'wrap' },
                                    h(Card, {}, h(CardContent, {},
                                        h(Btn, {
                                            icon: UpdateIcon,
                                            ...!x.isNewer && x.prerelease && { color: 'warning', variant: 'outlined' },
                                            onClick: () => update(x.tag_name)
                                        }, prefix("Install ", x.name, x.isNewer ? '' : " (older)")),
                                        h(Box, { mt: 1 }, renderChangelog(x.body))
                                    )),
                                )),
                        ))
    )
}

function renderChangelog(s: string) {
    return md(s, { onText })

    function onText(s: string) {
        return replaceStringToReact(s, /(?<=^|\W)#(\d+)\b/g, m =>  // link issues
            h(Link, { href: REPO_URL + 'issues/' + m[1], target: '_blank' }, h(OpenInNew) ))
    }
}

async function update(tag?: string) {
    if (!await confirmDialog("Installation may take less than a minute, depending on the speed of your server")) return
    toast('Downloading')
    await apiCall('update', { tag })
    toast("Restarting")
    const restarting = Date.now()
    let warning: undefined | ReturnType<typeof alertDialog>
    while (await apiCall('NONE').then(() => 0, e => !e.code)) { // while we get no response
        if (!warning && Date.now() - restarting > 15_000)
            warning = alertDialog("This is taking too long, please check your server", 'warning')
        await wait(500)
    }
    warning?.close()
    // the server is back on, SSE is restored and login dialog may appear, unwanted because we are just waiting to reload
    subscribeKey(state, 'loginRequired', () => state.loginRequired = false)
    await alertDialog("Procedure complete", 'success')
    window.location.reload() // show new gui
}

type Color = '' | 'success' | 'warning' | 'error'

function entry(color: Color, ...content: ReactNode[]) {
    return h(Box, {
            fontSize: 'x-large',
            color: th => color && th.palette[color]?.main,
        },
        h(({ success: CheckCircle, info: Info, '': Info, warning: Warning, error: Error })[color], {
            sx: { mr: 1, color: color ? undefined : 'primary.main' }
        }),
        ...content)
}

function fsLink(text=`File System page`) {
    return h(InLink, { to:'fs' }, text)
}

function cfgLink(text=`Options page`) {
    return h(InLink, { to: 'options' }, text)
}

export function proxyWarning(cfg: any, status: any) {
    return cfg.data && !cfg.data.proxies && status?.proxyDetected
        ? "A proxy was detected but none is configured" : ''
}

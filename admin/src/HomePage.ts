// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Box, Button, LinearProgress, Link } from '@mui/material'
import { apiCall, useApi, useApiEx, useApiList } from './api'
import { Dict, dontBotherWithKeys, InLink, objSameKeys, onlyTruthy } from './misc'
import { CheckCircle, Error, Info, Launch, Warning } from '@mui/icons-material'
import md from './md'
import { useSnapState } from './state'
import { confirmDialog } from './dialog'
import { isCertError, isKeyError, makeCertAndSave } from './OptionsPage'
import { VfsNode } from './VfsPage'
import { Account } from './AccountsPage'

export const REPO_URL = 'https://github.com/rejetto/hfs/'

interface ServerStatus { listening: boolean, port: number, error?: string, busy?: string }

export default function HomePage() {
    const SOLUTION_SEP = " — "
    const { username } = useSnapState()
    const { data: status, reload: reloadStatus, element: statusEl } = useApiEx<Dict<ServerStatus>>('get_status')
    const { data: vfs } = useApiEx<{ root?: VfsNode }>('get_vfs')
    const [account] = useApi<Account>(username && 'get_account')
    const { data: cfg, reload: reloadCfg } = useApiEx('get_config', { only: ['https_port', 'cert', 'private_key', 'proxies', 'ignore_proxies'] })
    const { list: plugins } = useApiList('get_plugins')
    if (statusEl || !status)
        return statusEl
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const errorMap = objSameKeys(status, v =>
        v.busy ? [`port ${v.port} already used by ${v.busy}${SOLUTION_SEP}choose a `, cfgLink('different port'), ` or stop ${v.busy}`]
            : v.error )
    const errors = errorMap && onlyTruthy(Object.entries(errorMap).map(([k,v]) =>
        v && [md(`Protocol _${k}_ cannot work: `), v,
            (isCertError(v) || isKeyError(v)) && [
                SOLUTION_SEP, h(Link, { sx: { cursor: 'pointer' }, onClick() { makeCertAndSave().then(reloadCfg).then(reloadStatus) } }, "make one"),
                " or ", SOLUTION_SEP, cfgLink("provide adequate files")
            ]]))
    return h(Box, { display:'flex', gap: 2, flexDirection:'column' },
        username && entry('', "Welcome "+username),
        errors.length ? dontBotherWithKeys(errors.map(msg => entry('error', dontBotherWithKeys(msg))))
            : entry('success', "Server is working"),
        !vfs ? h(LinearProgress)
            : !vfs.root?.children?.length && !vfs.root?.source ? entry('warning', "You have no files shared", SOLUTION_SEP, fsLink("add some"))
                : entry('', md("This is Admin-panel, where you manage your server. Access your files on "),
                    h(Link, { target:'frontend', href: '/' }, "Front-end", h(Launch, { sx: { verticalAlign: 'sub', ml: '.2em' } }))),
        !href && entry('warning', "Frontend unreachable: ",
            ['http','https'].map(k => k + " " + (errorMap[k] ? "is in error" : "is off")).join(', '),
            !errors.length && [ SOLUTION_SEP, cfgLink("switch http or https on") ]
        ),
        plugins.find(x => x.badApi) && entry('warning', "Some plugins may be incompatible"),
        !account?.adminActualAccess && entry('', md("On _localhost_ you don't need to login"),
            SOLUTION_SEP, h(InLink, { to:'accounts' }, md("to access from another computer create an account with /admin/ permission")) ),
        proxyWarning(cfg, status) && entry('warning', "A proxy was detected but none is configured",
                SOLUTION_SEP, cfgLink("set the number of proxies"),
                SOLUTION_SEP, "unless you are sure and you can ", h(Button, {
                    size: 'small',
                    async onClick() {
                        if (await confirmDialog("Go on only if you know what you are doing")
                        && await apiCall('set_config', { values: { ignore_proxies: true } }))
                            reloadCfg()
                    }
                }, "ignore this warning"),
                SOLUTION_SEP, h(Link, { target: 'help', href: REPO_URL + 'wiki/Proxy-warning' }, "Explanation")
        ),
        status.frpDetected && entry('warning', `FRP is detected. It should not be used with "type = tcp" with HFS. Possible solutions are`,
            h('ol',{},
                h('li',{}, `configure FRP with type=http (best solution)`),
                h('li',{}, md(`configure FRP to connect to HFS _not_ with 127.0.0.1 (safe, but you won't see users' IPs)`)),
                h('li',{}, `disable "admin access for localhost" in HFS (safe, but you won't see users' IPs)`),
            )),
        entry('', h(Link, { target: 'support', href: REPO_URL + 'discussions' }, "Get support")),
    )
}

type Color = '' | 'success' | 'warning' | 'error'

function entry(color: Color, ...content: any[]) {
    return h(Box, {
            fontSize: 'x-large',
            color: th => color && th.palette[color]?.main,
        },
        h(({ success: CheckCircle, info: Info, '': Info, warning: Warning, error: Error })[color], {
            sx: { mb: '-3px', mr: 1, color: color ? undefined : 'primary.main' }
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
    return cfg && !cfg.proxies && !cfg.ignore_proxies && status?.proxyDetected
}

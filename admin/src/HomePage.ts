// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, isValidElement } from 'react'
import { Box, Button, Link } from '@mui/material'
import { apiCall, useApi, useApiComp, useApiList } from './api'
import { Dict, dontBotherWithKeys, InLink, objSameKeys, onlyTruthy } from './misc'
import { CheckCircle, Error, Info, Launch, Warning } from '@mui/icons-material'
import md from './md'
import { useSnapState } from './state'
import { confirmDialog } from './dialog'
import { isCertError, makeCertAndSave } from './ConfigPage'
import { VfsNode } from './VfsPage'
import { Account } from './AccountsPage'

interface ServerStatus { listening: boolean, port: number, error?: string, busy?: string }

export default function HomePage() {
    const SOLUTION_SEP = " — "
    const { username } = useSnapState()
    const [status, reloadStatus] = useApiComp<Dict<ServerStatus>>('get_status')
    const [vfs] = useApiComp<{ root?: VfsNode }>('get_vfs')
    const [account] = useApi<Account>(username && 'get_account')
    const [cfg, reloadCfg] = useApiComp('get_config', { only: ['https_port', 'cert', 'private_key', 'proxies', 'ignore_proxies'] })
    const { list: plugins } = useApiList('get_plugins')
    if (!status || isValidElement(status))
        return status
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const errorMap = objSameKeys(status, v =>
        v.busy ? [`port ${v.port} already used by ${v.busy}${SOLUTION_SEP}choose a `, cfgLink('different port'), ` or stop ${v.busy}`]
            : v.error )
    const errors = errorMap && onlyTruthy(Object.entries(errorMap).map(([k,v]) =>
        v && [md(`Protocol _${k}_ cannot work: `), v,
            isCertError(v) && [
                SOLUTION_SEP, h(Link, { sx: { cursor: 'pointer' }, onClick() { makeCertAndSave().then(reloadCfg).then(reloadStatus) } }, "make one"),
                " or ",
                SOLUTION_SEP, cfgLink("provide adequate files")
            ]]))
    console.log(plugins)
    return h(Box, { display:'flex', gap: 2, flexDirection:'column' },
        username && entry('', "Welcome "+username),
        errors.length ? dontBotherWithKeys(errors.map(msg => entry('error', dontBotherWithKeys(msg))))
            : entry('success', "Server is working"),
        !vfs || isValidElement(vfs) ? vfs
            : !vfs.root?.children?.length && !vfs.root?.source ? entry('warning', "You have no files shared", SOLUTION_SEP, fsLink("add some"))
                : entry('', md("Here you manage your server. There is a _separated_ interface to access your shared files: "),
                    h(Link, { target:'frontend', href: '/' }, "Frontend interface", h(Launch, { sx: { verticalAlign: 'sub', ml: '.2em' } }))),
        !href && entry('warning', "Frontend unreachable: ",
            ['http','https'].map(k => k + " " + (errorMap[k] ? "is in error" : "is off")).join(', '),
            !errors.length && [ SOLUTION_SEP, cfgLink("switch http or https on") ]
        ),
        plugins.find(x => x.badApi) && entry('warning', "Some plugins may be incompatible"),
        !account?.adminActualAccess && entry('', md("You are accessing on _localhost_ where permission is not required"),
            SOLUTION_SEP, h(InLink, { to:'accounts' }, "give admin access to an account to be able to access from other computers") ),
        proxyWarning(cfg, status) && entry('warning', "A proxy was detected but none is configured",
                SOLUTION_SEP, cfgLink("set the number of proxies"),
                SOLUTION_SEP, "unless you are sure you can ", h(Button, {
                    async onClick() {
                        if (await confirmDialog("Go on only if you know what you are doing")
                        && await apiCall('set_config', { values: { ignore_proxies: true } }))
                            reloadCfg()
                    }
                }, "ignore this warning")),
        status.frpDetected && entry('warning', `FRP is detected. It should not be used with "type = tcp" with HFS. Possible solutions are`,
            h('ol',{},
                h('li',{}, `configure FRP with type=http (best solution)`),
                h('li',{}, md(`configure FRP to connect to HFS _not_ with 127.0.0.1 (safe, but you won't see users' IPs)`)),
                h('li',{}, `disable "admin access for localhost" in HFS (safe, but you won't see users' IPs)`),
            ))
    )
}

type Color = '' | 'success' | 'warning' | 'error'

function entry(color: Color, ...content: any[]) {
    return h(Box, {
            fontSize: 'x-large',
            color: th => color && th.palette[color]?.main,
        },
        h(({ success: CheckCircle, info: Info, '': Info, warning: Warning, error: Error })[color], {
            sx: { mb: '-3px', mr: 1 }
        }),
        ...content)
}

function fsLink(text=`File System page`) {
    return h(InLink, { to:'fs' }, text)
}

function cfgLink(text=`Configuration page`) {
    return h(InLink, { to:'configuration' }, text)
}

export function proxyWarning(cfg: any, status: any) {
    return cfg && !cfg.proxies && !cfg.ignore_proxies && status.proxyDetected
}

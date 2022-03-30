// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react'
import { Box, Link } from '@mui/material'
import { useApi } from './api'
import { Dict, dontBotherWithKeys, InLink, objSameKeys, onlyTruthy, spinner } from './misc'
import { CheckCircle, Error, Info, Launch, Warning } from '@mui/icons-material'
import md from './md'
import { useSnapState } from './state'

interface ServerStatus { listening: boolean, port: number, error?: string, busy?: string }

export default function HomePage() {
    const SOLUTION_SEP = " — "
    const { username } = useSnapState()
    const [status] = useApi<Dict<ServerStatus>>('get_status')
    const [vfs] = useApi('get_vfs')
    const [account] = useApi(username && 'get_account')
    const [cfg] = useApi('get_config', { only: ['https_port', 'cert', 'private_key'] })
    if (!status)
        return spinner()
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const errorMap = objSameKeys(status, v =>
        v.busy ? [`port ${v.port} already used by ${v.busy}${SOLUTION_SEP}choose a `, cfgLink('different port'), ` or stop ${v.busy}`]
            : v.error )
    const errors = errorMap && onlyTruthy(Object.entries(errorMap).map(([k,v]) =>
        v && [md(`Protocol _${k}_ cannot work: `), v, typeof v === 'string' && /certificate|key/.test(v) && [SOLUTION_SEP, cfgLink("provide adequate files")]]))
    return h(Box, { display:'flex', gap: 2, flexDirection:'column' },
        username && entry('', "Welcome "+username),
        !cfg ? spinner() :
            errors.length ? dontBotherWithKeys(errors.map(msg => entry('error', dontBotherWithKeys(msg))))
                : entry('success', "Server is working"),
        !vfs ? spinner()
            : !vfs.root?.children?.length && !vfs.root?.source
            ? entry('warning', "You have no files shared", SOLUTION_SEP, fsLink("add some"))
            : entry('', "Here you manage your server. There is a SEPARATED interface to access your shared files: ",
                h(Link, { target:'frontend', href: '/' }, "Frontend interface", h(Launch, { sx: { verticalAlign: 'sub', ml: '.2em' } }))),
        ! href && entry('warning', "Frontend unreachable: ",
            !cfg ? '...'
                : errors.length === 2 ? "both http and https are in error"
                    : h(Fragment, {},
                        ['http','https'].map(k => k + " " + (errorMap[k] ? "is in error" : "is off")).join(', '),
                        !errors.length && h(Fragment, {}, SOLUTION_SEP, cfgLink("switch http or https on"))
                    )
        ),
        !account?.adminActualAccess && entry('', "You are accessing on localhost, therefore permission is not required",
            SOLUTION_SEP, h(InLink, { to:'accounts' }, "give admin access to an account to be able to access from other computers") ),
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

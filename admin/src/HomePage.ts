import { createElement as h } from 'react'
import { Alert, Box, Link } from '@mui/material'
import { useApi } from './api'
import { Dict, dontBotherWithKeys, InLink, objSameKeys, onlyTruthy, spinner } from './misc'
import { Launch } from '@mui/icons-material'
import md from './md'

interface ServerStatus { listening: boolean, port: number, error?: string, busy?: string }

export default function HomePage() {
    const [status] = useApi<Dict<ServerStatus>>('get_status')
    const [vfs] = useApi('get_vfs')
    const [cfg] = useApi('get_config', { only: ['https_port', 'cert', 'private_key'] })
    if (!status)
        return spinner()
    const { http, https } = status
    const goSecure = !http?.listening && https?.listening ? 's' : ''
    const srv = goSecure ? https : (http?.listening && http)
    const href = srv && `http${goSecure}://`+window.location.hostname + (srv.port === (goSecure ? 443 : 80) ? '' : ':'+srv.port)
    const errorMap = objSameKeys(status, v =>
        v.busy ? [`port ${v.port} already used by ${v.busy} - choose a `, cfgLink('different port'), ` or stop ${v.busy}`]
            : v.error )
    const errors = errorMap && onlyTruthy(Object.entries(errorMap).map(([k,v]) =>
        v && [md(`Protocol _${k}_ cannot work: `), v, typeof v === 'string' && /certificate|key/.test(v) && [' - ', cfgLink("provide adequate files")]]))
    return h(Box, { display:'flex', gap: 2, flexDirection:'column' },
        !cfg ? spinner() :
            errors.length ? errors.map((msg, i) => h(Alert, { key: i, severity: 'error' }, dontBotherWithKeys(msg)))
                : href && h(Alert, { severity: 'success' }, "Server is working"),
        href ? h(Box, { my:1, ml:1 },
            h(Box, { fontSize:'200%' },
                h(Link, { target:'frontend', href }, "Open frontend interface",
                    h(Launch, { sx: { ml:1, mt:1 } }),
                )
            ),
            h(Box, { color:'text.secondary' },
                `Inside frontend your users can see the files and folders you decide in the File System.`)
        ) : h(Alert, { severity: 'warning' }, "Frontend unreachable: ",
            !cfg ? '...'
                : errors.length === 2 ? "both http and https are in error"
                    : [
                        ['http','https'].map(k => k + " " + (errorMap[k] ? "is in error" : "is off")).join(', '),
                        !errors.length && [' - ', cfgLink("switch http or https on")]
                    ]
        ),

        vfs?.root && !vfs.root.children?.length && !vfs.root.source &&
            h(Alert, { severity: 'warning' }, "You have no files shares - ", fsLink("add some files"))
    )
}

function fsLink(text=`File System page`) {
    return h(InLink, { to:'fs' }, text)
}

function cfgLink(text=`Configuration page`) {
    return h(InLink, { to:'configuration' }, text)
}

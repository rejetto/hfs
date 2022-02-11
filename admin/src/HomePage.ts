import { createElement as h } from 'react'
import { Alert, Box, Link } from '@mui/material'
import { useApi } from './api'
import { spinner } from './misc'
import { Launch } from '@mui/icons-material'
import { Link as RouterLink } from 'react-router-dom'

export default function HomePage() {
    const [status] = useApi('get_status')
    const [vfs] = useApi('get_vfs')
    const { http, https } = status || {}
    const secure = !http?.active && https?.active ? 's' : ''
    const srv = secure ? https : (http?.active && http)
    const href = srv && `http${secure}://`+window.location.hostname + (srv.port === (secure ? 443 : 80) ? '' : ':'+srv.port)
    return !status ? spinner() :
        h(Box, { display:'flex', gap: 2, flexDirection:'column' },
            href ? h(Box, {},
                h(Alert, { severity: 'success' }, "Server is working"),
                h(Box, { mt:2, fontSize:'200%' },
                    h(Link, { target:'frontend', href }, "Open frontend interface",
                        h(Launch, { sx: { ml:1, mt:1 } }),
                    )
                ),
                h(Box, { color:'text.secondary' },
                    `Inside frontend your users can see the files and folders you decide in the File System.`)
            ) : h(Alert, { severity: 'warning' }, "Frontend switched off"),

            vfs?.root && !vfs.root.children?.length && !vfs.root.source &&
                h(Alert, { severity: 'warning', sx:{ mt:2 } }, "You have no files shared. Go add some in the ", h(RouterLink, { to:'fs' }, h(Link, {}, `File System page.`)))
        )
}

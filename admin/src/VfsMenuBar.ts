// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode } from 'react'
import { Alert, Box, List, ListItem, ListItemIcon, ListItemText } from '@mui/material'
import { Storage } from '@mui/icons-material'
import { osIcon } from './LogsPage'
import { reloadVfs } from './VfsPage'
import { prefix } from './misc'
import { Btn, Flex, reloadBtn, useBreakpoint } from './mui'
import { apiCall, ApiObject, useApi } from './api'
import VfsPathField from './VfsPathField'
import { alertDialog, promptDialog } from './dialog'
import { formatDiskSpace } from './FilePicker'
import { getDiskSpaces } from '../../src/util-os'

export default function VfsMenuBar({ statusApi, add }: { add: ReactNode, statusApi: ApiObject }) {
    return h(Flex, {
        zIndex: 2,
        backgroundColor: 'background.paper',
        width: 'fit-content',
    },
        reloadBtn(() => reloadVfs()),
        h(Btn, {
            icon: Storage,
            title: "Disk spaces",
            progress: false,
            onClick: () => apiCall<Awaited<ReturnType<typeof getDiskSpaces>>>('get_disk_spaces').then(res =>
                alertDialog(h(List, { dense: true }, res.map(x => h(ListItem, { key: x.name },
                    h(ListItemIcon, {}, h(Storage)),
                    h(ListItemText, {
                        sx: { wordBreak: 'break-word' },
                        primary: x.name + prefix(' (', x.description, ')'),
                        secondary: formatDiskSpace(x)
                    }),
                ))), { title: "Disk spaces" })
                    .then(() => false), // no success-animation for IconBtn
                alertDialog)
        }),
        add,
        h(SystemIntegrationButton, statusApi.data)
    )
}

function SystemIntegrationButton({ platform }: { platform: string | undefined }) {
    const isWindows = platform === 'win32'
    const { data: integrated, reload } = useApi(isWindows && 'windows_integrated')
    const sm = useBreakpoint('sm')
    return !isWindows ? null : h(Btn, {
        icon: osIcon('win'),
        variant: 'outlined',
        doneMessage: true,
        ...(!integrated?.is ? {
            children: "System integration",
            async onClick() {
                const msg = h(Box, { width: { xs: '100%', sm: '34em' } },
                    h('img', { src: 'win-shell.png', style: { display: 'block', width: '100%' }  }),
                    h(Alert, { severity: 'info' }, "We are going to add a command in the right-click of Windows File Manager.",
                        h(Box, {}, "It will also automatically copy the URL, ready to paste!")),
                )
                const parent = await promptDialog(msg, {
                    field: { comp: VfsPathField, label: "Add to this folder", placeholder: "home",
                        autoFocus: sm }, // this dialog is tall, and mobile keyboard will disrupt user's ability to view its content
                    form: { saveOnEnter: false }
                })
                return typeof parent === 'string' && apiCall('windows_integration', { parent }).then(reload)
            }
        } : {
            confirm: true,
            children: "Remove integration",
            onClick: () => apiCall('windows_remove').then(reload),
        })
    })
}
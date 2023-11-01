// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Alert, Box } from '@mui/material'
import { Add, Microsoft } from '@mui/icons-material'
import { reloadVfs } from './VfsPage'
import addFiles, { addLink, addVirtual } from './addFiles'
import MenuButton from './MenuButton'
import { Btn, reloadBtn } from './misc'
import { apiCall, useApi } from './api'
import { confirmDialog } from './dialog'

export default function VfsMenuBar({ status }: any) {
    const { data: integrated, reload } = useApi(status?.platform === 'win32' && 'windows_integrated')
    return h(Box, {
        display: 'flex',
        gap: 2,
        mb: 2,
        sx: {
            position: 'sticky',
            top: 0,
            zIndex: 2,
            backgroundColor: 'background.paper',
            width: 'fit-content',
        },
    },
        h(MenuButton, {
            variant: 'contained',
            startIcon: h(Add),
            items: [
                { children: "from disk", onClick: addFiles },
                { children: "virtual folder", onClick: addVirtual },
                { children: "web-link", onClick: addLink  },
            ]
        }, "Add"),
        reloadBtn(() => reloadVfs()),
        status?.platform === 'win32' && h(Btn, {
            icon: Microsoft,
            variant: 'outlined',
            doneMessage: true,
            ...(!integrated?.is ? {
                children: "System integration",
                onClick: () => windowsIntegration().then(reload),
            } : {
                confirm: true,
                children: "Remove integration",
                onClick: () => apiCall('windows_remove').then(reload),
            })
        }),
    )
}

async function windowsIntegration() {
    const msg = h(Box, {}, "We are going to add a command in the right-click of Windows File Manager",
        h('img', { src: 'win-shell.png', style: {
            display: 'block',
            width: 'min(30em, 80vw)',
            marginTop: '1em',
        }  }),
        h(Alert, { severity: 'info' }, "It will also automatically copy the URL, ready to paste!"),
    )
    return await confirmDialog(msg)
        && apiCall('windows_integration')
}

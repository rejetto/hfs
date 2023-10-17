// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Box } from '@mui/material'
import { Add, Microsoft } from '@mui/icons-material'
import { reloadVfs } from './VfsPage'
import addFiles, { addVirtual } from './addFiles'
import MenuButton from './MenuButton'
import { basename, Btn, reloadBtn } from './misc'
import { apiCall } from './api'
import { alertDialog, confirmDialog } from './dialog'

export default function VfsMenuBar({ status }: any) {
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
                { children: "virtual folder", onClick: addVirtual  }
            ]
        }, "Add"),
        reloadBtn(() => reloadVfs()),
        status?.platform === 'win32' && h(Btn, {
            icon: Microsoft,
            variant: 'outlined',
            onClick: windowsIntegration
        }, "System integration"),
    )
}

async function windowsIntegration() {
    const msg = h(Box, {}, "We are going to add a command in the right-click of Windows File Manager",
        h('img', { src: 'win-shell.png', style: {
            display: 'block',
            width: 'min(30em, 80vw)',
            marginTop: '1em',
        }  }),
    )
    if (!await confirmDialog(msg)) return
    const hint = alertDialog("Click YES to the next 2 dialogs. The second dialog may not appear, and you need to click on the bottom bar.", 'warning')
    const { finish } = await apiCall('windows_integration', {}, { timeout: 60 })
    hint.close()
    return finish ? alertDialog("To finish the process, please execute the file you'll find on your desktop: " + basename(finish))
        : alertDialog("Done!", 'success')
}
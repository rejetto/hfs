// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { Box } from '@mui/material'
import { Add } from '@mui/icons-material'
import { reloadVfs } from './VfsPage'
import addFiles, { addVirtual } from './addFiles'
import MenuButton from './MenuButton'
import { reloadBtn } from './misc'

export default function VfsMenuBar() {
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
    )
}

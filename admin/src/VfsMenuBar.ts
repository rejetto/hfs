import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Box, Button } from '@mui/material'
import { Add, Delete, Refresh } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'
import { apiCall } from './api'
import { reloadVfs } from './VfsPage'
import addFiles, { addVirtual } from './addFiles'
import MenuButton from './MenuButton'

export default function VfsMenuBar() {
    const { selectedFiles } = useSnapState()
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
                { children: 'from disk', onClick: addFiles },
                { children: 'virtual folder', onClick: addVirtual  }
            ]
        }, 'Add'),
        h(Button, { onClick: removeFiles, disabled: !selectedFiles.length, startIcon: h(Delete) }, 'Remove'),
        h(Button, { onClick(){ reloadVfs() }, startIcon: h(Refresh) }, 'Reload'),
    )
}

async function removeFiles() {
    const f = state.selectedFiles
    if (!f.length) return
    if (await confirmDialog(`Remove ${f.length} item(s)?`)) {
        try {
            const uris = f.map(x => x.id)
            const { errors } = await apiCall('del_vfs', { uris })
            const urisThatFailed = uris.filter((uri, idx) => errors[idx])
            if (urisThatFailed.length)
                return alertDialog("Following elements couldn't be removed: " + urisThatFailed.join(', '), 'error')
            reloadVfs()
        }
        catch(e) {
            await alertDialog(e as Error)
        }
    }

}

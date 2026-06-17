// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react'
import { Box } from '@mui/material'
import { ContentCut, ContentPaste, Delete } from '@mui/icons-material'
import { Btn } from './mui'
import { deleteVfs } from './VfsPage'
import { Callback } from './misc'
import { alertDialog } from './dialog'
import { state, useSnapState } from './state'
import { getMoveVfsError, moveVfs } from './VfsMove'
import _ from 'lodash'

export default function VfsActionButtons({ files, pasteTo, done }: {
    files: readonly VfsActionNode[]
    pasteTo?: VfsActionNode
    done?: Callback
}) {
    const { movingFiles } = useSnapState()
    const actionFiles = files.filter(x => !x.isRoot)
    const actionIds = actionFiles.map(x => x.id)
    return h(Fragment, {},
        h(Btn, {
            icon: ContentCut,
            disabled: !files.length ? "Select something to cut"
                : !actionIds.length ? "Cannot cut Home"
                : _.isEqual(actionIds.slice().sort(), movingFiles.slice().sort()) && "Already cut",
            title: "Cut (you can also use drag & drop to move items)",
            'aria-label': "Cut",
            onClick() {
                state.movingFiles = actionIds
                alertDialog(h(Box, {}, "Now that this is marked for moving, click on the destination folder, and then the paste button ", h(ContentPaste)), 'info')
            },
        }),
        movingFiles.length > 0 && h(Btn, {
            icon: ContentPaste,
            disabled: !pasteTo ? "Select destination folder" : getMoveVfsError(movingFiles, pasteTo.id),
            title: movingFiles.join('\n'),
            async onClick() {
                if (pasteTo && moveVfs(movingFiles, pasteTo.id))
                    state.movingFiles = []
            },
        }),
        h(Btn, {
            icon: Delete,
            title: "Delete",
            disabled: !files.length ? "Select something to delete"
                : !actionIds.length && "Cannot delete Home",
            onClick() {
                deleteVfs(actionIds)
                done?.()
            },
        }),
    )
}

type VfsActionNode = {
    readonly id: string
    readonly isRoot?: true
}

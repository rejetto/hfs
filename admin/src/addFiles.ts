// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { alertDialog, newDialog, promptDialog, toast } from './dialog'
import { createElement as h, Fragment } from 'react'
import { Box } from '@mui/material'
import { reloadVfs } from './VfsPage'
import { state } from './state'
import { apiCall } from './api'
import FilePicker from './FilePicker'
import { focusSelector, pathEncode } from '@hfs/shared'

let lastFolder: undefined | string
export default function addFiles() {
    const { close } = newDialog({
        title: "Add files or folders",
        dialogProps: { sx:{ minWidth: 'min(90vw, 40em)', minHeight: 'calc(100vh - 9em)' } },
        Content() {
            const parent = getFolderFromSelected()
            return h(Fragment, {},
                h(Box, { sx:{ typography: 'body1', px: 1, py: 2 } },
                    "Selected elements will be added under ",
                    parent.isRoot ? h('i', {}, "Home") : decodeURI(parent.id)
                ),
                h(FilePicker, {
                    from: lastFolder ?? parent.source,
                    async onSelect(sel) {
                        const res = await Promise.all(sel.map(source =>
                            apiCall('add_vfs', { parent: parent.id, source }).then(r => r, e => [source, e.message])))
                        lastFolder = sel[0].slice(0, sel[0].lastIndexOf('/'))
                        const errs = res.filter(Array.isArray)
                        if (errs.length)
                            await alertDialog(h(Box, {},
                                "Some elements have been rejected",
                                h('ul', {},
                                    errs.map(([file, err]) =>
                                        h('li', { key: file }, file, ': ', err))
                                )
                            ), 'error')
                        const ids = res.filter(x => x.name).map(x => parent.id + pathEncode(x.name) + (x.link.endsWith('/') ? '/' : ''))
                        reloadVfs(ids)
                        close()
                    }
                })
            )
        }
    })
}

export async function addVirtual() {
    try {
        const name = await promptDialog("Enter folder name")
        if (!name) return
        const { id: parent } = getFolderFromSelected()
        const res = await apiCall('add_vfs', { parent, name })
        await alertDialog(`Folder "${res.name}" created`, 'success')
        reloadVfs([ parent + pathEncode(res.name) + '/' ])
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

export async function addLink() {
    try {
        const { id: parent } = getFolderFromSelected()
        const res = await apiCall('add_vfs', { parent, name: 'new link', url: 'https://example.com' })
        reloadVfs([ parent + pathEncode(res.name) ])
        toast("Link created", 'success', {
            onClose: () => focusSelector('input[name=url]')
        })
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

function getFolderFromSelected() {
    const f = state.selectedFiles[0] || state.vfs
    return f.type === 'folder' ? f : f.parent!
}

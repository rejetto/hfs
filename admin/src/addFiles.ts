// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { alertDialog, newDialog, promptDialog, toast } from './dialog'
import { createElement as h, Fragment } from 'react'
import { Box } from '@mui/material'
import { id2node, VfsNodeAdmin } from './VfsPage'
import { state } from './state'
import { apiCall } from './api'
import FilePicker from './FilePicker'
import { basename, focusSelector, pathEncode } from '@hfs/shared'

let lastFolder: undefined | string
export default function addFiles() {
    const { close } = newDialog({
        title: "Add files or folders",
        dialogProps: { sx:{ minWidth: 'min(80vw, 40em)', minHeight: 'calc(100vh - 9em)' } },
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
                        addNodes(parent, sel.map(source => ({ source, name: basename(source), id: '' })))
                        lastFolder = sel[0].slice(0, sel[0].lastIndexOf('/'))
                        close()
                    }
                })
            )
        }
    })
}

function addNodes(parent: VfsNodeAdmin, nodes: VfsNodeAdmin[]) {
    for (const n of nodes) {
        n.id ||= parent.id + pathEncode(n.name)
        id2node.set(n.id, n)
        n.parent = parent
        if (!n.source && !n.url)
            n.type = 'folder'
    }
    ;(parent.children ||= []).push(...nodes)
    state.vfs = { ...state.vfs! } // trigger refresh
    state.selectedFiles = nodes
}

export async function addVirtual() {
    try {
        let name = await promptDialog("Enter folder name")
        if (!name) return
        const parent = getFolderFromSelected()
        const res = await apiCall('get_free_name', { parent: parent.id, name })
        name = res?.name
        if (!name) return
        addNodes(parent, [{ name, id: '' }])
        toast(`Folder "${name}" created`, 'success') // the name may have a number appended
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

export async function addLink() {
    try {
        const parent = getFolderFromSelected()
        let name = 'new link'
        const res = await apiCall('get_free_name', { parent: parent.id, name })
        name = res?.name
        if (!name) return
        addNodes(parent, [{ name, url: 'https://example.com', id: '' }])
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

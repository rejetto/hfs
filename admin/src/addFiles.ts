// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { alertDialog, newDialog, promptDialog, toast } from './dialog'
import { createElement as h, Fragment } from 'react'
import { Box } from '@mui/material'
import { reindexVfs, VfsNodeAdmin } from './VfsPage'
import { addToChildrenOf } from './VfsTree'
import { state } from './state'
import FilePicker from './FilePicker'
import { basename, extname, focusSelector } from '@hfs/shared'

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
        if (n.source?.endsWith('/') || !n.source && !n.url)
            n.type = 'folder'
        n.id ||= parent.id + n.name + (n.type === 'folder' ? '/' : '')
        n.parent = parent
    }
    addToChildrenOf(parent, nodes)
    reindexVfs({ select: nodes })
}

function getFreeName(parent: VfsNodeAdmin, name: string) {
    const ext = extname(name)
    const noExt = ext ? name.slice(0, -ext.length) : name
    let idx = 2
    while (parent.children?.find(isSameFilenameAs(name)))
        name = `${noExt} ${idx++}${ext}`
    return name
}

function normalizeFilename(x: string) {
    return x.toLocaleLowerCase().normalize() // in this context we always use lowercase for comparison
}

export function isSameFilenameAs(name: string) {
    const normalized = normalizeFilename(name)
    return (other: string | VfsNodeAdmin) =>
        normalized === normalizeFilename(typeof other === 'string' ? other : other.name)
}

export async function addVirtual() {
    try {
        let name = await promptDialog("Enter folder name")
        if (!name) return
        const parent = getFolderFromSelected()
        name = getFreeName(parent, name)
        if (!name) return
        addNodes(parent, [{ name, id: '', type: 'folder' }])
        toast(`Folder "${name}" created`, 'success') // the name may have a number appended
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

export async function addLink() {
    try {
        const parent = getFolderFromSelected()
        const name = getFreeName(parent, 'new link')
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

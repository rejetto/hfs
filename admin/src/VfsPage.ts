// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { apiCall, useApiEx } from './api'
import { Alert, Button, Card, CardContent, Grid, Link, List, ListItem, ListItemText, Typography } from '@mui/material'
import { state, useSnapState } from './state'
import VfsMenuBar from './VfsMenuBar'
import VfsTree, { vfsNodeIcon } from './VfsTree'
import { Flex, IconBtn, newDialog, onlyTruthy, prefix, useBreakpoint, VfsNodeAdminSend } from './misc'
import { reactJoin } from '@hfs/shared'
import _ from 'lodash'
import { AlertProps } from '@mui/material/Alert/Alert'
import FileForm from './FileForm'
import { Close, Delete } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'

let selectOnReload: string[] | undefined

export default function VfsPage() {
    const [id2node] = useState(() => new Map<string, VfsNode>())
    const { vfs, selectedFiles, movingFile } = useSnapState()
    const { data, reload, element } = useApiEx('get_vfs')
    useMemo(() => vfs || reload(), [vfs, reload])
    const anyMask = useMemo(() => {
        let f = selectedFiles[0]
        while (f)
            if (_.isEmpty(f.masks))
                f = f.parent as  any
            else
                return true
    }, [selectedFiles])
    const sideBreakpoint = 'md'
    const isSideBreakpoint = useBreakpoint(sideBreakpoint)
    const statusApi = useApiEx('get_status')
    const { data: status } = statusApi
    const urls = useMemo<string[]>(() => {
        const b = status?.baseUrl
        const ret = status?.urls.https || status?.urls.http
        return b && !ret.includes(b) ? [b, ...ret] : ret
    }, [status])

    function selectNone() {
        state.selectedFiles = []
    }

    const sideContent = !selectedFiles.length ? null
        : selectedFiles.length === 1 ? h(FileForm, {
                addToBar: isSideBreakpoint && h(IconBtn, { // not really useful, but users misled in thinking it's a dialog will find satisfaction in dismissing the form
                    icon: Close,
                    title: "Close",
                    onClick: selectNone
                }),
                anyMask,
                statusApi,
                file: selectedFiles[0] as VfsNode  // it's actually Snapshot<VfsNode> but it's easier this way
            })
            : h(Fragment, {},
                h(Flex, { alignItems: 'center' },
                    h(Typography, {variant: 'h6'}, selectedFiles.length + ' selected'),
                    h(Button, { onClick: deleteFiles, startIcon: h(Delete) }, "Remove"),
                ),
                h(List, { dense: true, disablePadding: true },
                    selectedFiles.map(f => h(ListItem, { key: f.id },
                        h(ListItemText, { primary: f.name, secondary: f.source }) ))
                )
            )

    // this will take care of closing the dialog, for user's convenience, after "cut" button is pressed
    const [closeDialog, setCloseDialog] = useState(() => _.noop)
    useEffect(() => {
        if (movingFile === selectedFiles[0]?.id) closeDialog()
    }, [movingFile, closeDialog])
    useEffect(() => {
        if (isSideBreakpoint || !sideContent) return
        const { close } = newDialog({
            title: selectedFiles.length > 1 ? "Multiple selection" :
                h(Flex, { alignItems: 'center' }, vfsNodeIcon(selectedFiles[0] as VfsNode), selectedFiles[0].name || "Home"),
            Content: () => sideContent,
            onClose: selectNone,
        })
        setCloseDialog(() => close)
        return close
    }, [isSideBreakpoint, selectedFiles])

    useEffect(() => {
        state.vfs = undefined
        if (!data) return
        // rebuild id2node
        id2node.clear()
        const { root } = data
        if (!root) return
        root.isRoot = true
        recur(root) // this must be done before state change that would cause Tree to render and expecting id2node
        state.vfs = root
        // refresh objects of selectedFiles
        const ids = selectOnReload || state.selectedFiles.map(x => x.id)
        selectOnReload = undefined
        state.selectedFiles = onlyTruthy(ids.map(id =>
            id2node.get(id)))

        // calculate id and parent fields, and builds the map id2node
        function recur(node: VfsNode, pre='/', parent: VfsNode|undefined=undefined) {
            node.parent = parent
            node.id = node.isRoot ? '/' : prefix(pre, encodeURIComponent(node.name), node.type === 'folder' ? '/' : '')
            id2node.set(node.id, node)
            if (!node.children) return
            for (const n of node.children)
                recur(n, node.id, node)
        }

    }, [data, id2node])
    if (element) {
        id2node.clear()
        return element
    }
    const anythingShared = !data?.root?.children?.length && !data?.root?.source
    const alert: AlertProps | false = anythingShared ? {
        severity: 'warning',
        children: "Add something to your shared files — click Add"
    } : urls && {
        severity: 'info',
        children: [
            "Your shared files can be browsed from ",
            reactJoin(" or ", urls.slice(0,3).map(href => h(Link, { href }, href)))
        ]
    }
    return h(Grid, { container:true, rowSpacing: 1, columnSpacing: 2 },
        alert && h(Grid, { item: true, mb: 2, xs: 12 }, h(Alert, alert)),
        h(Grid, { item:true, [sideBreakpoint]: 6, lg: 5, xl: 4 },
            h(Typography, { variant: 'h6', mb:1, }, "Virtual File System"),
            h(Alert, { severity: 'info' }, "If you rename or delete here, it's virtual, and only affects what is presented to the users"),
            h(VfsMenuBar, { status }),
            vfs && h(VfsTree, { id2node })),
        isSideBreakpoint && sideContent && h(Grid, { item:true, [sideBreakpoint]: true, maxWidth:'100%' },
            h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                h(CardContent, {}, sideContent) ))
    )
}

export function reloadVfs(pleaseSelect?: string[]) {
    selectOnReload = pleaseSelect
    state.vfs = undefined
}

export async function deleteFiles() {
    const f = state.selectedFiles
    if (!f.length) return
    if (!await confirmDialog(`Delete ${f.length} item(s)?`)) return
    try {
        const uris = f.map(x => x.id)
        _.pull(uris, '/')
        const { errors } = await apiCall('del_vfs', { uris })
        const urisThatFailed = uris.filter((uri, idx) => errors[idx])
        if (urisThatFailed.length)
            return alertDialog("Following elements couldn't be deleted: " + urisThatFailed.join(', '), 'error')
        reloadVfs()
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

export interface VfsNode extends Omit<VfsNodeAdminSend, 'ctime' | 'mtime' | 'children'> {
    id: string
    ctime?: string
    mtime?: string
    default?: string
    children?: VfsNode[]
    parent?: VfsNode
    isRoot?: true
}

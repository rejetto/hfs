// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { apiCall, useApiEx } from './api'
import { Alert, Box, Button, Card, CardContent, Grid, Link, List, ListItem, ListItemText, Typography } from '@mui/material'
import { state, useSnapState } from './state'
import VfsMenuBar from './VfsMenuBar'
import VfsTree, { vfsNodeIcon } from './VfsTree'
import { newDialog, onlyTruthy, prefix, VfsNodeAdminSend } from './misc'
import { Flex, useBreakpoint } from './mui'
import { reactJoin } from '@hfs/shared'
import _ from 'lodash'
import { AlertProps } from '@mui/material/Alert/Alert'
import FileForm, { Account } from './FileForm'
import { Delete } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'

let selectOnReload: string[] | undefined

export default function VfsPage() {
    const [id2node] = useState(() => new Map<string, VfsNode>())
    const { vfs, selectedFiles, movingFile } = useSnapState()
    const { data, reload, element } = useApiEx('get_vfs')
    useMemo(() => vfs || reload(), [vfs, reload])
    const sideBreakpoint = 'md'
    const isSideBreakpoint = useBreakpoint(sideBreakpoint)
    const statusApi = useApiEx('get_status')
    const { data: status } = statusApi
    const urls = useMemo<string[]>(() => {
        const b = status?.baseUrl
        const ret = status?.urls.https || status?.urls.http
        return b && !ret.includes(b) ? [b, ...ret] : ret
    }, [status])
    const single = selectedFiles.length < 2 && (selectedFiles[0] as VfsNode || vfs)
    const accountsApi = useApiEx<{ list: Account[] }>('get_accounts') // load accounts once and for all, or !isSideBreakpoint will cause a call for each selection

    // this will take care of closing the dialog, for user's convenience, after "cut" button is pressed
    const closeDialogRef = useRef(_.noop)
    useEffect(() => {
        if (movingFile === selectedFiles[0]?.id)
            closeDialogRef.current()
    }, [movingFile])

    const sideContent = accountsApi.element || !vfs ? null
        : single ? h(FileForm, {
            addToBar: isSideBreakpoint && h(Box, { flex: 1, textAlign: 'right', mr: 1, color: '#8883' }, vfsNodeIcon(single)),
            statusApi,
            saved: () => closeDialogRef.current(),
            accounts: accountsApi?.data?.list ?? [],
            file: single  // it's actually Snapshot<VfsNode> but it's easier this way
        })
        : h(Fragment, {},
            h(Flex, {},
                h(Typography, {variant: 'h6'}, selectedFiles.length + ' selected'),
                h(Button, { onClick: deleteFiles, startIcon: h(Delete) }, "Remove"),
            ),
            h(List, { dense: true, disablePadding: true },
                selectedFiles.map(f => h(ListItem, { key: f.id },
                    h(ListItemText, { primary: f.name, secondary: f.source }) ))
            )
        )

    useEffect(() => {
        if (isSideBreakpoint || !sideContent || !selectedFiles.length) return
        const ancestors = ['']
        {
            let r = single && single.parent
            while (r && !r.isRoot) {
                ancestors.push(r.name)
                r = r.parent
            }
        }
        const { close } = newDialog({
            title: selectedFiles.length > 1 ? "Multiple selection" :
                h(Flex, {},
                    vfsNodeIcon(selectedFiles[0] as VfsNode),
                    h(Flex, { flexWrap: 'wrap', gap: '0 0.5em' },
                        selectedFiles[0].name || "Home",
                        h(Box, { component: 'span', color: 'text.secondary' }, ancestors.join(' /'))
                    )
                ),
            dialogProps: { sx: { justifyContent: 'flex-end' } },
            Content: () => sideContent,
            onClose() {
                state.selectedFiles = []
            },
        })
        closeDialogRef.current = close
        return () => void close() // auto-close dialog if we are switching to side-panel
    }, [isSideBreakpoint, _.last(selectedFiles)?.id])

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
        state.selectedFiles = consumeSelectOnReload()
            || onlyTruthy(state.selectedFiles.map(x => id2node.get(x.id))) // refresh with new objects

        function consumeSelectOnReload() {
            if (selectOnReload)
                closeDialogRef.current() // noop when side-paneling
            const ret = selectOnReload && onlyTruthy(selectOnReload.map(id => id2node.get(id)))
            selectOnReload = undefined
            return ret
        }

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
            reactJoin(" or ", urls.slice(0,3).map(href => h(Link, { href, target: 'frontend' }, href)))
        ]
    }
    const scrollProps = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' } as const
    return h(Fragment, {},
        h(Box, { mb: 2 },
            h(Alert, { severity: 'info' }, "If you rename or delete here, it's virtual, and only affects what is presented to the users"),
            alert && h(Alert, alert),
        ),
        h(Grid, { container: true, rowSpacing: 1, columnSpacing: 2, top: 0, flex: '1 1 auto', height: 0 },
            h(Grid, { item: true, xs: 12, [sideBreakpoint]: 6, lg: 6, xl: 5, ...scrollProps  },
                h(Flex, { mb: 1, flexWrap: 'wrap', gap: [0, 2] },
                    h(Typography, { variant: 'h6' }, "Virtual File System"),
                    h(VfsMenuBar, { statusApi }),
                ),
                vfs && h(VfsTree, { id2node, statusApi }) ),
            isSideBreakpoint && sideContent && h(Grid, { item: true, [sideBreakpoint]: true, maxWidth: '100%', ...scrollProps },
                h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                    h(CardContent, {}, sideContent)) )
        )
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

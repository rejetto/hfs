// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useMemo, useState } from 'react'
import { useApi, useApiEx } from './api'
import { Alert, Grid, Link, List, ListItem, ListItemText, Typography } from '@mui/material'
import { state, useSnapState } from './state'
import VfsMenuBar from './VfsMenuBar'
import VfsTree from './VfsTree'
import { onlyTruthy, prefix } from './misc'
import { reactJoin } from '@hfs/shared'
import _ from 'lodash'
import { AlertProps } from '@mui/material/Alert/Alert'
import FileForm from './FileForm'

let selectOnReload: string[] | undefined

export default function VfsPage() {
    const [id2node] = useState(() => new Map<string, VfsNode>())
    const { vfs, selectedFiles } = useSnapState()
    const { data, reload, element } = useApiEx('get_vfs')
    useMemo(() => vfs || reload(), [vfs, reload])
    useEffect(() => {
        state.vfs = undefined
        if (!data) return
        // rebuild id2node
        id2node.clear()
        const { root } = data
        if (!root) return
        recur(root) // this must be done before state change that would cause Tree to render and expecting id2node
        root.isRoot = true
        state.vfs = root
        // refresh objects of selectedFiles
        const ids = selectOnReload || state.selectedFiles.map(x => x.id)
        selectOnReload = undefined
        state.selectedFiles = onlyTruthy(ids.map(id =>
            id2node.get(id)))

        // calculate id and parent fields, and builds the map id2node
        function recur(node: VfsNode, pre='', parent: VfsNode|undefined=undefined) {
            node.parent = parent
            node.id = prefix(pre, node.name) || '/' // root
            id2node.set(node.id, node)
            if (!node.children) return
            for (const n of node.children)
                recur(n, (pre && node.id) + '/', node)
        }

    }, [data, id2node])
    const [status] = useApi(window.location.host === 'localhost' && 'get_status')
    const urls = useMemo(() =>
        typeof status === 'object'
            && _.sortBy(
                onlyTruthy(Object.values(status.urls?.https || status.urls?.http || {}).map(u => typeof u === 'string' && u)),
                url => url.includes('[')
            ),
        [status])
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
    return h(Grid, { container:true, rowSpacing: 1, maxWidth: '80em', columnSpacing: 2 },
        alert && h(Grid, { item: true, mb: 2, xs: 12 }, h(Alert, alert)),
        h(Grid, { item:true, sm: 6, lg: 5 },
            h(Typography, { variant: 'h6', mb:1, }, "Virtual File System"),
            h(VfsMenuBar),
            vfs && h(VfsTree, { id2node })),
        h(Grid, { item:true, sm: 6, lg: 7, maxWidth:'100%' },
            selectedFiles.length === 0 ? null
                : selectedFiles.length === 1 ? h(FileForm, {
                    defaultPerms: data?.defaultPerms as VfsPerms,
                    file: selectedFiles[0] as VfsNode  // it's actually Snapshot<VfsNode> but it's easier this way
                })
                    : h(List, {},
                        selectedFiles.length + ' selected',
                        selectedFiles.map(f => h(ListItem, { key: f.name },
                            h(ListItemText, { primary: f.name, secondary: f.source }) ))))
    )
}

export function reloadVfs(pleaseSelect?: string[]) {
    selectOnReload = pleaseSelect
    state.vfs = undefined
}

export interface VfsPerms {
    can_see?: Who
    can_read?: Who
    can_upload?: Who
}
export interface VfsNode extends VfsPerms {
    id: string
    name: string
    type?: 'folder'
    source?: string
    size?: number
    ctime?: string
    mtime?: string
    default?: string
    children?: VfsNode[]
    parent?: VfsNode
    website?: true
    masks?: any
    isRoot?: true
}

const WHO_ANYONE = true
const WHO_NO_ONE = false
const WHO_ANY_ACCOUNT = '*'
type AccountList = string[]
export type Who = typeof WHO_ANYONE
    | typeof WHO_NO_ONE
    | typeof WHO_ANY_ACCOUNT
    | AccountList

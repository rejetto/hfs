// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { apiCall, useApiEx } from './api'
import { Alert, Box, Button, Card, CardContent, Grid, Link, List, ListItem, ListItemText, Typography } from '@mui/material'
import { state, useSnapState } from './state'
import VfsTree, { vfsNodeIcon } from './VfsTree'
import {
    CFG, matches, newDialog, normalizeHost, onlyTruthy, pathEncode, prefix, VfsNodeAdminSend, HIDE_IN_TESTS, wait
} from './misc'
import { Flex, useBreakpoint } from './mui'
import { reactJoin } from '@hfs/shared'
import _ from 'lodash'
import { Account } from './AccountsPage'
import FileForm from './FileForm'
import { Add, Delete } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'
import { PageProps } from './App'

let selectOnReload: string[] | undefined
let exposeVfsLoading: Promise<unknown> | undefined

export default function VfsPage({ setTitleSide }: PageProps) {
    const [id2node] = useState(() => new Map<string, VfsNode>())
    const { vfs, selectedFiles, movingFile } = useSnapState()
    const { data, reload, element, loading } = useApiEx('get_vfs')
    exposeVfsLoading = loading
    useMemo(() => vfs || reload(), [vfs, reload])
    const { data: config } = useApiEx('get_config', { only: [CFG.force_address, CFG.base_url] })
    const sideBreakpoint = 'md'
    const isSideBreakpoint = useBreakpoint(sideBreakpoint)
    const statusApi = useApiEx('get_status')
    const { data: status } = statusApi
    const urls = useMemo<string[]>(() => {
        const force = config?.[CFG.force_address] // when force_address, we'll only suggest urls that will be accepted
        const ret = (status?.urls.https || status?.urls.http)?.filter((url: string) => {
            if (!force) return true
            const host = normalizeHost(new URL(url).host)
            return Object.keys(status.roots).some(mask => matches(host, mask))
        })
        const b = force ? config?.[CFG.base_url] : status?.baseUrl // when force_address, we should only consider user-inputted urls, otherwise 'automatic' is also good
        if (b && ret && !ret.includes(b))
            ret.unshift(b)
        return ret
    }, [status, config])
    const accountsApi = useApiEx<{ list: Account[] }>('get_accounts') // load accounts once and for all, or !isSideBreakpoint will cause a call for each selection
    const accounts = useMemo(() => _.sortBy(accountsApi?.data?.list, 'username'), [accountsApi.data])

    // this will take care of closing the dialog, for the user's convenience, after "cut" button is pressed
    const closeDialogRef = useRef(_.noop)
    useEffect(() => {
        if (movingFile === selectedFiles[0]?.id)
            closeDialogRef.current()
    }, [movingFile])

    const nothingShared = !data?.root?.children?.length && !data?.root?.source
    const hintElement = useMemo(() => nothingShared ? h(Alert, {
        severity: 'warning',
        children: h(Fragment, {}, "Add something to your virtual file system — click the ", h(Add), "button, or set a source for the Home folder"),
    }) : urls?.length > 0 && h(Alert, {
        severity: 'info',
        children: [
            "Your shared files can be browsed from ",
            h('span', { className: HIDE_IN_TESTS, key: 0 },
                reactJoin(" or ", urls.slice(0,3).map(href => h(Link, { href, target: 'frontend' }, href))) )
        ]
    }), [nothingShared, urls])

    setTitleSide(useMemo(() => h(Box, { sx: { display: { xs: 'none', md: 'block' }  } },
        h(Alert, { severity: 'info' }, "If you rename or delete here, it's virtual, and only affects what is presented to the users"),
        hintElement,
    ), [hintElement]))

    const single = selectedFiles?.length < 2 && selectedFiles[0] as VfsNode
    const sideContent = accountsApi.element || !vfs || !selectedFiles.length ? null
        : single ? h(FileForm, {
            key: single.id,
            isSideBreakpoint,
            addToBar: isSideBreakpoint && h(Box, { flex: 1, textAlign: 'right', mr: 1, color: '#8883' }, vfsNodeIcon(single)),
            statusApi,
            saved: () => closeDialogRef.current(),
            accounts: accounts ?? [],
            file: single
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
                closeDialogRef.current() // this is noop when side-paneling
            const ret = selectOnReload && onlyTruthy(selectOnReload.map(id => id2node.get(id)))
            selectOnReload = undefined
            return ret
        }

        // calculate id and parent fields, and builds the map id2node
        function recur(node: VfsNode, pre='/', parent: VfsNode|undefined=undefined) {
            node.parent = parent
            node.id = node.isRoot ? '/' : prefix(pre, pathEncode(node.name), node.type === 'folder' ? '/' : '')
            id2node.set(node.id, node)
            if (!node.children) return
            node.children = _.sortBy(node.children, ['type', x => x.name?.toLocaleLowerCase()])
            for (const n of node.children)
                recur(n, node.id, node)
        }

    }, [data, id2node])
    if (element) {
        id2node.clear()
        return element
    }
    const scrollProps = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' } as const
    return h(Grid, { container: true, rowSpacing: 1, columnSpacing: 2, top: 0, flex: '1 1 auto', height: 0 },
        h(Grid, { item: true, xs: 12, [sideBreakpoint]: 5, lg: 6, xl: 5, ...scrollProps  },
            id2node.size > 0 && h(VfsTree, { id2node, statusApi }) ),
        isSideBreakpoint && sideContent && h(Grid, { item: true, [sideBreakpoint]: true, maxWidth: '100%', ...scrollProps },
            h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                h(CardContent, {}, sideContent)) )
    )
}

export function reloadVfs(pleaseSelect?: string[]) {
    selectOnReload = pleaseSelect
    state.vfs = undefined
    return wait(100).then(() => exposeVfsLoading) // ensure the loading started and finished. Not great, but does the job. Consider a cleaner solution.
}

async function deleteFiles() {
    const f = state.selectedFiles
    if (!f.length) return
    if (!await confirmDialog(`Delete ${f.length} item(s)?`)) return
    try {
        const uris = f.map(x => x.id).sort()
        _.remove(uris, (x, i) => i // exclude first, but remove descendants as they are both redundant and would cause errors
            && _.findLastIndex(uris, y => x.startsWith(y), i - 1) !== -1) // search backward among previous elements, as they array is sorted
        _.pull(uris, '/')
        const { errors } = await apiCall('del_vfs', { uris })
        const urisThatFailed = uris.filter((_uri, idx) => errors[idx])
        if (urisThatFailed.length)
            return alertDialog("Following elements couldn't be deleted: " + urisThatFailed.join(', '), 'error')
        reloadVfs()
    }
    catch(e) {
        await alertDialog(e as Error)
    }
}

export interface VfsNode extends Omit<VfsNodeAdminSend, 'birthtime' | 'mtime' | 'children'> {
    id: string
    birthtime?: string
    mtime?: string
    default?: string
    children?: VfsNode[]
    parent?: VfsNode
    isRoot?: true
}

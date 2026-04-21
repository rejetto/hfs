// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useEffect, useMemo, useRef } from 'react'
import { useApiEx, useApiList } from './api'
import {
    Alert, Box, Button, Card, CardContent, Grid, Link, List, ListItem, ListItemText, Typography
} from '@mui/material'
import { LsEntry } from '../../src/api.vfs'
import { ListLsItem } from './FilePicker'
import { markVfsModified, prepareVfsUndo, state, useSnapState } from './state'
import VfsTree, { vfsNodeIcon } from './VfsTree'
import {
    CFG, matches, newDialog, normalizeHost, onlyTruthy, pathEncode, prefix, VfsNodeAdminSend, HIDE_IN_TESTS, wait,
    isWhoObject, PERM_KEYS, VfsPerms, Who,
} from './misc'
import { Flex, useBreakpoint } from './mui'
import { reactJoin } from '@hfs/shared'
import _ from 'lodash'
import apiAccounts from '../../src/api.accounts'
import FileForm from './FileForm'
import { Add, Delete } from '@mui/icons-material'
import { toast } from './dialog'
import { PageProps } from './App'

let selectOnReload: string[] | undefined
let exposeVfsLoading: Promise<unknown> | undefined
export const id2vfsNode = new Map<string, VfsNodeAdmin>()

export default function VfsPage({ setTitleSide }: PageProps) {
    const { vfs, selectedFiles, movingFile, vfsShowDiskContentFor } = useSnapState()
    const { data, reload, element, loading } = useApiEx('get_vfs')
    exposeVfsLoading = loading
    useEffect(() => {
        if (!vfs)
            reload()
    }, [vfs, reload])
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
    const accountsApi = useApiEx<typeof apiAccounts.get_accounts>('get_accounts') // load accounts once and for all, or !isSideBreakpoint will cause a call for each selection
    const accounts = useMemo(() => _.sortBy(accountsApi?.data?.list, 'username'), [accountsApi.data])
    const diskContent = useApiList<LsEntry>(vfsShowDiskContentFor && 'get_ls', { path: vfsShowDiskContentFor })

    // this will take care of closing the dialog, for the user's convenience, after "cut" button is pressed
    const closeDialogRef = useRef(_.noop)
    useEffect(() => {
        if (movingFile === selectedFiles[0]?.id)
            closeDialogRef.current()
    }, [movingFile])

    const nothingShared = data && !data.root?.children?.length && !data.root?.source
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
        h(Alert, { severity: 'info' }, "This is what your users will see. Edit it freely – files on disk won’t be changed."),
        hintElement,
    ), [hintElement]))

    const single = selectedFiles?.length < 2 && selectedFiles[0] as VfsNodeAdmin
    const sideContent = useMemo(() => accountsApi.element || !vfs ? null
        : diskContent.enabled ? diskContent.element || h(Box, {},
            h(Box, { fontSize: 'xx-large', sx: { wordBreak: 'break-all' } }, "From ", vfsShowDiskContentFor),
            h(List, { dense: true },
                diskContent.list.map(it =>
                    h(ListItem, { key: it.n, sx: { borderTop: '1px solid #8888' } }, h(ListLsItem, { it })))
            )
        )
        : single ? h(FileForm, {
            key: single.id,
            isSideBreakpoint,
            addToBar: isSideBreakpoint && h(Box, { flex: 1, textAlign: 'right', mr: 1, color: '#8883' }, vfsNodeIcon(single)),
            statusApi,
            saved: () => closeDialogRef.current(),
            accounts: accounts ?? [],
            file: single
        })
        : !selectedFiles.length ? null
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
    , [accountsApi.element, vfs, diskContent.list, single, selectedFiles])

    useEffect(() => {
        if (isSideBreakpoint || !sideContent) return
        const ancestors = ['']
        {
            let r = single && single.parent
            while (r && !r.isRoot) {
                ancestors.push(r.name)
                r = r.parent
            }
        }
        const { close } = newDialog({
            title: vfsShowDiskContentFor ? "Disk content"
                : selectedFiles.length > 1 ? "Multiple selection" :
                h(Flex, {},
                    vfsNodeIcon(selectedFiles[0] as VfsNodeAdmin),
                    h(Flex, { flexWrap: 'wrap', gap: '0 0.5em' },
                        selectedFiles[0].name || "Home",
                        h(Box, { component: 'span', color: 'text.secondary' }, ancestors.join(' /'))
                    )
                ),
            dialogProps: { sx: { justifyContent: 'flex-end' } },
            Content: () => sideContent,
            onClose(auto) {
                if (auto) return
                state.selectedFiles = []
                state.vfsShowDiskContentFor = ''
            },
        })
        closeDialogRef.current = close
        return () => void close(true) // true = auto-closing
    }, [isSideBreakpoint, _.last(selectedFiles)?.id, sideContent])

    useEffect(() => {
        if (state.vfs || !data) return
        const { root } = data
        if (!root) return
        root.isRoot = true
        state.vfs = root
        state.vfsUndo = undefined
        reindexVfs({ sortChildren: true, select: consumeSelectOnReload() })
        state.vfsModified = false

        function consumeSelectOnReload() {
            if (!selectOnReload) return
            closeDialogRef.current() // this is noop when side-paneling
            const ret = selectOnReload
            selectOnReload = undefined
            return ret
        }

    }, [data])
    if (element && !state.vfs) {
        id2vfsNode.clear()
        return element
    }
    const scrollProps = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' } as const
    return h(Grid, { container: true, rowSpacing: 1, columnSpacing: 2, top: 0, flex: '1 1 auto', height: 0 },
        h(Grid, { item: true, xs: 12, [sideBreakpoint]: 5, lg: 6, xl: 5, ...scrollProps  },
            h(VfsTree, { statusApi }) ),
        isSideBreakpoint && sideContent && h(Grid, { item: true, [sideBreakpoint]: true, maxWidth: '100%', ...scrollProps },
            h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                h(CardContent, {}, sideContent)) )
    )
}

export function reindexVfs({
    node=state.vfs,
    clearMap=true,
    sortChildren=false,
    select=state.selectedFiles,
}: {
    node?: VfsNodeAdmin
    clearMap?: boolean
    sortChildren?: boolean
    select?: VfsNodeAdmin[] | string[]
} = {}) {
    if (!node) return
    if (clearMap)
        id2vfsNode.clear()
    recur(node, node.parent?.id || '/', node.parent)
    state.vfsShowDiskContentFor = ''
    // Reindex can update ids/references; remap caller-provided selections to canonical nodes from id2node.
    if (select)
        state.selectedFiles = onlyTruthy(select.map(x => id2vfsNode.get(typeof x === 'string' ? x : x.id)))

    function recur(node: VfsNodeAdmin, pre: string, parent: VfsNodeAdmin | undefined) {
        const oldId = node.id
        node.parent = parent
        node.inherited = getInheritedPerms(node) // refresh cached inheritance while reindexing, because local edits do not get a server roundtrip
        const newId = node.isRoot ? '/' : prefix(pre, pathEncode(node.name), node.type === 'folder' ? '/' : '')
        if (oldId && oldId !== newId)
            id2vfsNode.delete(oldId)
        node.id = newId
        id2vfsNode.set(newId, node)
        if (!node.children) return
        if (sortChildren)
            node.children = _.sortBy(node.children, ['type', x => x.name?.toLocaleLowerCase()])
        for (const child of node.children)
            recur(child, node.id, node)
    }
}

export function getInheritedPerms(child: VfsNodeAdmin | undefined) {
    const parent = child?.parent
    if (!parent) return
    const ret: VfsPerms = {}
    for (const k of PERM_KEYS) {
        const inheritedPerm = getInheritedPerm(parent, k)
        // null is the form's local representation of an unset permission
        if (inheritedPerm !== undefined && child[k] == null)
            ret[k] = inheritedPerm
    }
    return _.isEmpty(ret) ? undefined : ret

    function getInheritedPerm(cursor: VfsNodeAdmin | undefined, perm: keyof VfsPerms): Who | undefined {
        while (cursor) {
            let inheritedPerm = cursor[perm]
            if (inheritedPerm != null) {
                if (!isWhoObject(inheritedPerm))
                    return inheritedPerm
                inheritedPerm = inheritedPerm.children
                if (inheritedPerm !== undefined)
                    return inheritedPerm
            }
            cursor = cursor.parent
        }
    }
}

export function reloadVfs(pleaseSelect?: string[]) {
    selectOnReload = pleaseSelect
    state.vfs = undefined
    return wait(100).then(() => exposeVfsLoading) // ensure the loading started and finished. Not great, but does the job. Consider a cleaner solution.
}

async function deleteFiles() {
    const f = state.selectedFiles
    if (!f.length) return
    deleteVfs(f.map(x => x.id))
    toast(`${f.length} item(s) deleted`, 'success')
}

export function deleteVfs(uris: string[]) {
    const sorted = _.uniq(uris).sort()
    const topLevelUris = sorted.filter((uri, idx) => uri !== '/'
        && (idx === 0 || _.findLastIndex(sorted, parentUri => isDescendantUri(uri, parentUri), idx - 1) < 0))
    if (!topLevelUris.length) return
    prepareVfsUndo()
    for (const uri of topLevelUris) {
        const node = id2vfsNode.get(uri)!
        const siblings = node.parent!.children!
        _.remove(siblings, { id: node.id })
    }
    if (state.movingFile && topLevelUris.some(uri => state.movingFile === uri || isDescendantUri(state.movingFile, uri)))
        state.movingFile = ''
    markVfsModified()
}

export function isDescendantUri(childUri: string, parentUri: string) {
    return parentUri.endsWith('/') && childUri.startsWith(parentUri)
}

export interface VfsNodeAdmin extends Omit<VfsNodeAdminSend, 'birthtime' | 'mtime' | 'children'> {
    id: string
    birthtime?: string
    mtime?: string
    default?: string
    children?: VfsNodeAdmin[]
    parent?: VfsNodeAdmin
    isRoot?: true
}

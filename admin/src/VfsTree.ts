// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, ReactElement, useCallback, useEffect, useRef, MouseEvent } from 'react'
import { TreeItem, TreeView } from '@mui/x-tree-view'
import {
    ChevronRight, ExpandMore, TheaterComedy, Folder, Home, Link, InsertDriveFileOutlined, Lock,
    RemoveRedEye, Web, Upload, Cloud, Delete, HighlightOff, UnfoldMore, UnfoldLess
} from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import { reloadVfs, VfsNode } from './VfsPage'
import { onlyTruthy, toMutable, Who, with_ } from './misc'
import { Flex, iconTooltip, useToggleButton } from './mui'
import VfsMenuBar from './VfsMenuBar'
import { apiCall, ApiObject } from './api'
import { alertDialog, confirmDialog } from './dialog'
import _ from 'lodash'

export const FolderIcon = Folder
export const FileIcon = InsertDriveFileOutlined

let once = true

export default function VfsTree({ id2node, statusApi }:{ id2node: Map<string, VfsNode>, statusApi: ApiObject }) {
    const { vfs, selectedFiles, expanded } = useSnapState()
    const dragging = useRef<string>()
    const Branch = useCallback(function({ node }: { node: Readonly<VfsNode> }): ReactElement {
        let { id, name, isRoot } = node
        const folder = node.type === 'folder'
        const ref = useRef<HTMLLIElement | null>()
        if (isRoot && ref.current)
            ref.current.firstElementChild?.classList.toggle('Mui-selected', !(selectedFiles.length && !_.find(selectedFiles, { id: '/' })))
        return h(TreeItem, {
            ref(el) { // workaround to permit drag&drop with mui5's tree
                el?.addEventListener('focusin', (e: any) => e.stopImmediatePropagation())
                ref.current = el
            },
            onDoubleClick: toggle,
            label:
                h(Box, {
                    draggable: !isRoot,
                    onDragStart() {
                        dragging.current = id
                    },
                    onDragOver(ev) {
                        if (!folder) return
                        const src = dragging.current
                        if (src?.startsWith(id) && !src.slice(id.length + 1, -1).includes('/')) return // dragging node (src) must not be direct child of destination (id)
                        ev.preventDefault()
                    },
                    async onDrop() {
                        const from = dragging.current
                        if (!from) return
                        if (await confirmDialog(`Moving ${from} under ${id}`))
                            moveVfs(from, id)
                    },
                    sx: {
                        display: 'flex',
                        gap: '.5em',
                        minHeight: '1.8em', pt: '.2em', // comfy, make single-line ones taller
                    }
                },
                h(Box, { display: 'flex', flex: 0, },
                    vfsNodeIcon(node),
                    // attributes
                    h(Box, { sx: {
                                flex: 0, ml: '2px', my: '2px', '&>*': { fontSize: '87%', opacity: .6, mt: '-2px' },
                                display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'auto auto', height: '1em',
                            } },
                        node.can_delete !== undefined && iconTooltip(Delete, "Delete permission"),
                        node.can_upload !== undefined && iconTooltip(Upload, "Upload permission"),
                        !isRoot && !node.source && !node.url && iconTooltip(Cloud, "Virtual (no source)"),
                        isRestricted(node.can_see) && iconTooltip(RemoveRedEye, "Restrictions on who can see"),
                        isRestricted(node.can_read) && iconTooltip(Lock, "Restrictions on who can download"),
                        node.default && iconTooltip(Web, "Show as web-page"),
                        node.masks && iconTooltip(TheaterComedy, "Masks"),
                        node.size === -1 && iconTooltip(HighlightOff, "Source not found"),
                        with_(_.findKey(statusApi.data?.roots, root => root === id.slice(1)), host =>
                            host && iconTooltip(Home, `home for ${host}`))
                    ),
                ),
                isRoot ? "Home folder" : (() => { // special rendering if the whole source is not too long, and the name was not customized
                    const ps = node.parent?.source
                    const { source } = node
                    const rel = ps && source?.startsWith(ps) && source > ps ? '.' + source.slice(ps.length) : source
                    return !rel || !source?.endsWith(name) || rel.length > 45 ? name
                        : h('span', {},
                            h('span', { style: { opacity: .4, fontSize: 'small' } }, rel.slice(0,-name.length)),
                            rel.slice(-name.length),
                        )
                })()
            ),
            collapseIcon: h(ExpandMore, { onClick: toggle }),
            expandIcon: h(ChevronRight, { onClick: toggle }),
            nodeId: id
        }, isRoot && !node.children?.length ? h(TreeItem, { nodeId: '?', label: h('i', {}, "nothing here") })
            : node.children?.map(x => h(Branch, { key: x.id, node: x })) )

        function isRestricted(who: Who | undefined) {
            return who !== undefined && who !== true
        }

        function toggle(ev: MouseEvent<any>){
            const was = state.expanded
            state.expanded = was.includes(id) ? was.filter(x => x !== id) : [...was, id]
            ev.preventDefault()
            ev.stopPropagation()
        }
    }, [statusApi.data])
    const ref = useRef<HTMLUListElement>(null)
    const allExpanded = expanded.length === id2node.size
    const initialExpansion = ['/', ...vfs?.children?.length === 1 ? [vfs.children[0].id] : []] // in case there's only one child, expand that too
    if (once) {
        once = false
        state.expanded = initialExpansion
    }
    const [_expandAll, toggleBtn] = useToggleButton("Collapse all", "Expand all", exp => ({
        icon: exp ? UnfoldLess : UnfoldMore,
        sx: { rotate: exp ? 0 : '180deg' },
        onClick() {
            state.expanded = allExpanded ? initialExpansion : Array.from(id2node.keys())
        }
    }), allExpanded)
    useEffect(() => {
        state.expanded = _.uniq(state.expanded.concat(state.selectedFiles.map(x => x.parent?.id || '')))
    }, [state.vfs])
    // be sure the selected element is visible
    const treeId = 'vfs'
    const first = selectedFiles[0]
    useEffect(() => document.getElementById(`${treeId}-${first?.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' as any }),
        [first])
    return h(Flex, { flexDirection: 'column', alignItems: 'stretch', flex: 1 },
        h(Flex, { mb: 1, flexWrap: 'wrap', gap: [1, 2] },
            h(Typography, { variant: 'h6' }, "Virtual File System"),
            h(VfsMenuBar, { statusApi, add: toggleBtn }),
        ),
        vfs && h(TreeView, {
            ref,
            expanded: toMutable(expanded),
            selected: selectedFiles.map(x => x.id),
            multiSelect: true,
            id: treeId,
            sx: {
                height: 0, flex: '1 1 auto',
                overflowX: 'auto',
                maxWidth: ref.current && `calc(100vw - ${16 + ref.current.offsetLeft}px)`, // limit possible horizontal scrolling to this element
                '& ul': { borderLeft: '1px dashed #444', marginLeft: '15px', paddingLeft: '15px' },
            },
            onNodeSelect(_ev, ids) {
                if (typeof ids === 'string') return // shut up ts
                state.selectedFiles = onlyTruthy(ids.map(id => id2node.get(id)))
            }
        }, h(Branch, { node: vfs as Readonly<VfsNode> }))
    )
}

export function moveVfs(from: string, to: string) {
    return apiCall('move_vfs', { from, parent: to }).then(() => {
        reloadVfs([ to + from.slice(1 + from.lastIndexOf('/', from.length-2)) ])
        return true
    }, alertDialog)
}

export function vfsNodeIcon(node: VfsNode) {
    return node.isRoot ? iconTooltip(Home, "home, or root if you like")
        : node.type === 'folder' ? iconTooltip(FolderIcon, "Folder")
            : node.url ? iconTooltip(Link, "Web-link")
                : iconTooltip(FileIcon, "File")
}
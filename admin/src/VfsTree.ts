// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, ReactElement, useCallback, useEffect, useRef, MouseEvent } from 'react'
import { TreeItem, SimpleTreeView } from '@mui/x-tree-view'
import {
    ChevronRight, ExpandMore, TheaterComedy, Folder, Home, Link, InsertDriveFileOutlined, Lock,
    RemoveRedEye, Web, Upload, Cloud, Delete, HighlightOff, UnfoldMore, UnfoldLess
} from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import { deleteVfs, id2vfsNode, isDescendantUri, reindexVfs, VfsNodeAdmin } from './VfsPage'
import { onlyTruthy, pathDecode, toMutable, wantArray, WhoVfs, with_ } from './misc'
import { Flex, iconTooltip, useToggleButton } from './mui'
import VfsMenuBar from './VfsMenuBar'
import { ApiObject } from './api'
import { toast } from './dialog'
import _ from 'lodash'
import { moveVfs } from './VfsMove'

export const FolderIcon = Folder
export const FileIcon = InsertDriveFileOutlined

let once = true

const SPECIAL_TREE_ITEM = '?'

export default function VfsTree({ statusApi, isSideBreakpoint }:{ statusApi: ApiObject, isSideBreakpoint: boolean }) {
    const { vfs, selectedFiles, expanded } = useSnapState()
    const dragging = useRef<string[]>()
    const Branch = useCallback(function({ node }: { node: Readonly<VfsNodeAdmin> }): ReactElement {
        let { id, name, isRoot } = node
        const isFolder = node.type === 'folder'
        const ref = useRef<HTMLLIElement | null>()
        if (isRoot && ref.current)
            ref.current.firstElementChild?.classList.toggle('Mui-selected', !(selectedFiles.length && !_.find(selectedFiles, { id: '/' })))
        const rootValue = pathDecode(id.slice(1))
        const rootFor = _.findKey(statusApi.data?.roots, v => v === rootValue)
        return h(TreeItem, {
            ref(el) {
                ref.current = el
            },
            onKeyUp(ev) {
                if (ev.key === 'Delete') {
                    deleteVfs([id])
                    ev.stopPropagation()
                }
            },
            onDoubleClick: toggle,
            label: h(Box, {
                draggable: !isRoot,
                onDragStart() {
                    dragging.current = selectedFiles.length ? selectedFiles.map(x => x.id) : [id]
                },
                onDragOver(ev) {
                    if (!isFolder) return
                    const src = dragging.current
                    if (!src?.length || src.every(x => x.startsWith(id) && !x.slice(id.length + 1, -1).includes('/'))) return // dragging nodes must not all be direct children of destination
                    ev.preventDefault()
                },
                async onDrop() {
                    const from = dragging.current
                    if (!from?.length) return
                    const movingCount = from.length
                    if (moveVfs(from, id))
                        toast(`Moved ${movingCount} item(s) under "${id2vfsNode.get(id)?.name}"`, 'success')
                },
                sx: {
                    display: 'flex',
                    gap: '.5em',
                    minHeight: '1.8em', pt: '.2em', // comfy, make single-line ones taller
                }
            },
                h(Box, { sx: { display: 'flex', flex: 0 } },
                    vfsNodeIcon(node),
                    // attributes, as icons
                    h(Box, {
                        sx: {
                            flex: 0, ml: '2px', my: '2px', '&>*': { fontSize: '87%', opacity: .6, mt: '-2px' },
                            display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'auto auto', height: '1em',
                        }
                    },
                        node.can_delete != null && iconTooltip(Delete, "Delete permission"),
                        node.can_upload != null && iconTooltip(Upload, "Upload permission"),
                        !isRoot && !node.source && !node.url && iconTooltip(Cloud, "Virtual (no source)"),
                        isRestricted(node.can_see) && iconTooltip(RemoveRedEye, "Restrictions on who can see"),
                        isRestricted(node.can_read) && iconTooltip(Lock, "Restrictions on who can download"),
                        node.default && iconTooltip(Web, "Show as web-page"),
                        node.masks && iconTooltip(TheaterComedy, "Masks"),
                        node.size === -1 && iconTooltip(HighlightOff, "Source not found"),
                        rootFor && iconTooltip(Home, `home for ${rootFor}`)
                    ),
                ),
                isRoot ? "Home folder" : name
            ),
            itemId: id
        }, with_(node.source && isFolder ? "files from " + node.source : !node.children?.length && isRoot && "nothing here", x =>
                x && h(TreeItem, { itemId: SPECIAL_TREE_ITEM + id, label: h('i', {}, x) })),
            ...node.children?.map(x => h(Branch, { key: x.id, node: x })) || []
        )

        function isRestricted(who: WhoVfs | undefined) {
            return who != null && who !== true
        }

        function toggle(ev: MouseEvent<any>){
            const was = state.expanded
            state.expanded = was.includes(id) ? was.filter(x => x !== id) : [...was, id]
            ev.preventDefault()
            ev.stopPropagation()
        }
    }, [selectedFiles, statusApi.data])
    const ref = useRef<HTMLUListElement>(null)
    const allExpanded = id2vfsNode.size > 0 && expanded.length === id2vfsNode.size
    const initialExpansion = ['/', ...vfs?.children?.length === 1 ? [vfs.children[0].id] : []] // in case there's only one child, expand that too
    if (once) {
        once = false
        state.expanded = initialExpansion
    }
    const [_expandAll, toggleBtn] = useToggleButton("Collapse all", "Expand all", exp => ({
        icon: exp ? UnfoldLess : UnfoldMore,
        sx: { rotate: exp ? 0 : '180deg' },
        onClick() {
            state.expanded = allExpanded ? initialExpansion : Array.from(id2vfsNode.keys())
        }
    }), allExpanded)
    useEffect(() => {
        state.expanded = _.uniq(state.expanded.concat(state.selectedFiles.map(x => x.parent?.id || '')))
    }, [state.vfs])
    // be sure the selected element is visible
    const treeId = 'vfs'
    const first = selectedFiles[0]
    useEffect(() => { // scrollIntoView in modern browsers is returning a Promise
        document.getElementById(`${treeId}-${first?.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }, [first])
    return h(Flex, { flexDirection: 'column', alignItems: 'stretch', flex: 1 },
        h(Flex, { mb: 1, flexWrap: 'wrap', gap: [1, 2], mt: '2px' /*account for the save button's outline*/ },
            h(Typography, { variant: 'h6' }, "Virtual File System"),
            h(VfsMenuBar, { statusApi, add: toggleBtn, isSideBreakpoint }),
        ),
        vfs && h(SimpleTreeView, {
            ref,
            expandedItems: toMutable(expanded),
            expansionTrigger: 'iconContainer',
            onExpandedItemsChange(_ev, ids) {
                // keep placeholder helper rows out of expansion state to avoid persisting fake ids
                state.expanded = wantArray(ids).filter((x): x is string => typeof x === 'string' && !x.startsWith(SPECIAL_TREE_ITEM))
            },
            selectedItems: selectedFiles.map(x => x.id),
            multiSelect: true,
            id: treeId,
            sx: {
                height: 0, flex: '1 1 auto',
                overflowX: 'auto',
                maxWidth: ref.current && `calc(100vw - ${16 + ref.current.offsetLeft}px)`, // limit possible horizontal scrolling to this element
                '& ul': { borderLeft: '1px dashed #444', marginLeft: '15px', paddingLeft: '15px' },
            },
            slots: {
                collapseIcon: ExpandMore,
                expandIcon: ChevronRight,
            },
            onSelectedItemsChange(_ev, ids) {
                const selectedIds = wantArray(ids) as string[]
                state.selectedFiles = onlyTruthy(selectedIds.map(id => id2vfsNode.get(id)))
                // this is the only point where we have special node ids that don't fit selectedFiles
                state.vfsShowDiskContentFor = selectedIds.length === 1
                    && selectedIds[0][0] === SPECIAL_TREE_ITEM
                    && id2vfsNode.get(selectedIds[0].slice(1))?.source || ''
            }
        }, h(Branch, { node: vfs as Readonly<VfsNodeAdmin> }))
    )
}

export function vfsNodeIcon(node: VfsNodeAdmin) {
    return node.isRoot ? iconTooltip(Home, "home, or root if you like")
        : node.type === 'folder' ? iconTooltip(FolderIcon, "Folder")
            : node.url ? iconTooltip(Link, "Web-link")
                : iconTooltip(FileIcon, "File")
}

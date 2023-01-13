// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, ReactElement, useState } from 'react'
import { TreeItem, TreeView } from '@mui/lab'
import {
    ChevronRight,
    ExpandMore,
    TheaterComedy,
    Folder,
    Home,
    InsertDriveFileOutlined,
    Lock,
    RemoveRedEye,
    Web
} from '@mui/icons-material'
import { Box } from '@mui/material'
import { VfsNode, Who } from './VfsPage'
import { iconTooltip, isWindowsDrive, onlyTruthy } from './misc'

export const FolderIcon = Folder
export const FileIcon = InsertDriveFileOutlined

export default function VfsTree({ id2node }:{ id2node: Map<string, VfsNode> }) {
    const { vfs, selectedFiles } = useSnapState()
    const [selected, setSelected] = useState<string[]>(selectedFiles.map(x => x.id)) // try to restore selection after reload
    const [expanded, setExpanded] = useState(Array.from(id2node.keys()))
    if (!vfs)
        return null
    return h(TreeView, {
        expanded,
        selected,
        multiSelect: true,
        sx: {
            overflowX: 'auto',
            '& ul': { borderLeft: '1px dashed #444', marginLeft: '15px' },
        },
        onNodeSelect(ev, ids) {
            setSelected(ids)
            state.selectedFiles = onlyTruthy(ids.map(id => id2node.get(id)))
        }
    }, recur(vfs as Readonly<VfsNode>))

    function isRestricted(who: Who | undefined) {
        return who !== undefined && who !== true
    }

    function recur(node: Readonly<VfsNode>): ReactElement {
        let { id, name, source, isRoot } = node
        if (!id)
            debugger
        const folder = node.type === 'folder'
        if (folder && !isWindowsDrive(source) && source === name) // we need a way to show that the name we are displaying is a source in this ambiguous case, so we add a redundant ./
            source = './' + source
        return h(TreeItem, {
            label: h(Box, {
                sx: {
                    display: 'flex',
                    gap: '.5em',
                    lineHeight: '2em',
                    alignItems: 'center',
                }
            },
                isRoot ? iconTooltip(Home, "home, or root if you like")
                    : folder ? iconTooltip(FolderIcon, "Folder")
                        : iconTooltip(FileIcon, "File"),
                isRestricted(node.can_see) && iconTooltip(RemoveRedEye, "Restrictions on who can see"),
                isRestricted(node.can_read) && iconTooltip(Lock, "Restrictions on who can download"),
                node.default && iconTooltip(Web, "Act as website"),
                node.masks && iconTooltip(TheaterComedy, "Masks"),
                isRoot ? "Home"
                    // special rendering if the whole source is not too long, and the name was not customized
                    : source?.length! < 45 && source?.endsWith(name) ? h('span', {},
                        h('span', { style: { opacity: .4 } }, source.slice(0,-name.length)),
                        h('span', {}, source.slice(-name.length)),
                    )
                    : name
            ),
            key: name,
            collapseIcon: h(ExpandMore, {
                onClick(ev) {
                    setExpanded( expanded.filter(x => x !== id) )
                    ev.preventDefault()
                    ev.stopPropagation()
                }
            }),
            expandIcon: h(ChevronRight, {
                onClick(ev) {
                    setExpanded( [...expanded, id] )
                    ev.preventDefault()
                    ev.stopPropagation()
                }
            }),
            nodeId: id
        }, isRoot && !node.children?.length ? h('i', {}, "nothing here") : node.children?.map(recur))
    }

}

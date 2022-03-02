// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { makeStyles } from '@mui/styles'
import { state, useSnapState } from './state'
import { createElement as h, Fragment, ReactElement, useState } from 'react'
import { TreeItem, TreeView } from '@mui/lab'
import {
    ChevronRight,
    ExpandMore,
    Face,
    Folder,
    Home,
    InsertDriveFileOutlined,
    Lock,
    RemoveRedEye
} from '@mui/icons-material'
import { VfsNode, Who } from './VfsPage'
import { isWindowsDrive, onlyTruthy } from './misc'

export const FolderIcon = Folder
export const FileIcon = InsertDriveFileOutlined

const useStyles = makeStyles({
    label: {
        display: 'flex',
        gap: '.5em',
        lineHeight: '2em',
        alignItems: 'center',
    },
    path: {
        opacity: .4,
    }
})

export default function VfsTree({ id2node }:{ id2node: Map<string, VfsNode> }) {
    const { vfs, selectedFiles } = useSnapState()
    const [selected, setSelected] = useState<string[]>(selectedFiles.map(x => x.id)) // try to restore selection after reload
    const [expanded, setExpanded] = useState(Array.from(id2node.keys()))
    const styles = useStyles()
    if (!vfs)
        return null
    return h(TreeView, {
        expanded,
        selected,
        multiSelect: true,
        onNodeSelect(ev, ids) {
            setSelected(ids)
            state.selectedFiles = onlyTruthy(ids.map(id => id2node.get(id)))
        }
    }, recur(vfs as Readonly<VfsNode>))

    function isRestricted(who: Who) {
        return who !== undefined && who !== true
    }

    function recur(node: Readonly<VfsNode>): ReactElement {
        let { id, name, source } = node
        if (!id)
            debugger
        const folder = node.type === 'folder'
        if (folder && !isWindowsDrive(source) && source === name) // we need a way to show that the name we are displaying is a source in this ambiguous case, so we add a redundant ./
            source = './' + source
        return h(TreeItem, {
            label: h('div', { className: styles.label },
                h(!name ? Home : folder ? FolderIcon : FileIcon),
                isRestricted(node.can_see) && h(RemoveRedEye),
                isRestricted(node.can_read) && h(Lock),
                node.masks && h(Face),
                !source?.endsWith(name) ? name
                    : h('span', {},
                        h('span', { className:styles.path }, source.slice(0,-name.length)),
                        h('span', {}, source.slice(-name.length)),
                    )
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
        }, node.children?.map(recur))
    }

}

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { markVfsModified, prepareVfsUndo, state } from './state'
import { id2vfsNode, isDescendantUri, reindexVfs, VfsNodeAdmin } from './VfsPage'
import { onlyTruthy, pathEncode, prefix } from './misc'
import { alertDialog } from './dialog'
import _ from 'lodash'

export type MoveVfsSources = string | readonly string[]

export function getMoveVfsError(from: MoveVfsSources, to: string) {
    const fromUris = normalizeMoveSources(from)
    if (fromUris.includes('/'))
        return "Cannot move root"
    const topLevelUris = getTopLevelMoveSources(fromUris)
    const fromNodes = onlyTruthy(topLevelUris.map(uri => id2vfsNode.get(uri)))
    if (fromNodes.length !== topLevelUris.length)
        return "Item to move not found"
    const toNode = id2vfsNode.get(to)
    if (!toNode || toNode.type !== 'folder')
        return "Destination folder not found"
    if (topLevelUris.some(uri => isDescendantUri(to, uri)))
        return "Cannot move inside itself"
    if (topLevelUris.every(uri => isDirectChildOf(uri, to)))
        return "Already in this folder"
    if (_.uniqBy(fromNodes, 'name').length !== fromNodes.length)
        return "Some selected items have the same name"
    if (fromNodes.some(fromNode => toNode.children?.some(x => x.name === fromNode.name && x.id !== fromNode.id)))
        return "Item with same name already present in destination"
    if (fromNodes.some(fromNode => !fromNode.parent?.children))
        return "Source parent not found"
}

export function moveVfs(from: MoveVfsSources, to: string) {
    const error = getMoveVfsError(from, to)
    if (error)
        return !alertDialog(error, 'error')
    const topLevelUris = getTopLevelMoveSources(normalizeMoveSources(from))
    const fromNodes = onlyTruthy(topLevelUris.map(uri => id2vfsNode.get(uri)))
    const toNode = id2vfsNode.get(to)!
    const destinationAncestors = getAncestorIds(toNode)
    const movedIds = fromNodes.map(fromNode =>
        prefix(to, pathEncode(fromNode.name), fromNode.type === 'folder' ? '/' : ''))
    prepareVfsUndo()
    for (const fromNode of fromNodes) {
        const oldSiblings = fromNode.parent!.children!
        _.remove(oldSiblings, { id: fromNode.id })
        // empty child arrays should not survive moves, or the admin tree keeps phantom expandable folders
        if (!oldSiblings.length)
            fromNode.parent!.children = undefined
    }
    addToChildrenOf(toNode, fromNodes)
    // ids and node references change after moving; select by the new ids after reindex
    reindexVfs({ select: movedIds })
    state.expanded = _.uniq([...state.expanded, ...destinationAncestors])
    return true
}

export function addToChildrenOf(parent: VfsNodeAdmin, moreChildren: VfsNodeAdmin[]) {
    if (!parent.children)
        parent.children = []
    // keep the assignment above and push separated: on proxied nodes, combining them will push to a stale array reference.
    parent.children.push(...moreChildren)

    markVfsModified()
}

function normalizeMoveSources(from: MoveVfsSources) {
    return _.uniq(typeof from === 'string' ? [from] : from).sort()
}

function getTopLevelMoveSources(fromUris: string[]) {
    return fromUris.filter((uri, idx) =>
        idx === 0 || _.findLastIndex(fromUris, parentUri => isDescendantUri(uri, parentUri), idx - 1) < 0)
}

function isDirectChildOf(childId: string, parentId: string) {
    return childId.startsWith(parentId) && !childId.slice(parentId.length + 1, -1).includes('/')
}

function getAncestorIds(node: VfsNodeAdmin) {
    const ret: string[] = []
    let cur: typeof node | undefined = node
    while (cur) {
        ret.push(cur.id)
        cur = cur.parent
    }
    return ret
}

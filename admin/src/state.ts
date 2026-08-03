// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { proxy, useSnapshot } from 'valtio'
import {
    Dict, isWhoObject, onlyTruthy, pathEncode, PERM_KEYS, prefix, VfsNodeAdminSend, VfsPerms, WhoVfs,
} from './misc'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { produce } from 'immer'

export interface VfsNodeAdmin extends Omit<VfsNodeAdminSend, 'birthtime' | 'mtime' | 'children'> {
    id: string
    birthtime?: string
    mtime?: string
    default?: string
    children?: VfsNodeAdmin[]
    parent?: VfsNodeAdmin
    isRoot?: true
    originalId: string
}

export const id2vfsNode = new Map<string, VfsNodeAdmin>()

const STORAGE_KEY = 'admin_state'
const INIT = {
    title: '',
    config: {} as Dict,
    selectedFiles: [] as VfsNodeAdmin[],
    vfsShowDiskContentFor: '',
    accountsAsTree: false,
    movingFiles: [] as string[],
    vfs: undefined as VfsNodeAdmin | undefined,
    vfsUndo: undefined as VfsNodeAdmin | undefined,
    vfsModified: false,
    expanded: [] as string[],
    loginRequired: false as boolean | number,
    username: '',
    monitorOnlyFiles: true,
    monitorWithLog: true,
    customHtmlSection: '',
    darkTheme: undefined as undefined | boolean,
    dataTablePersistence: {} as any,
    hideRandomPlugin: false,
    onlinePluginsColumns: {
        version: false,
        pushed_at: false,
        license: false,
    } as Dict<boolean>
}
Object.assign(INIT, JSON.parse(localStorage[STORAGE_KEY]||null))
export const state = proxy(INIT)
Object.assign(window, { state })

const SETTINGS_TO_STORE: (keyof typeof state)[] = ['onlinePluginsColumns', 'monitorOnlyFiles', 'monitorWithLog',
    'customHtmlSection', 'darkTheme', 'dataTablePersistence', 'accountsAsTree', 'hideRandomPlugin']
const storeSettings = _.debounce(() =>
    localStorage[STORAGE_KEY] = JSON.stringify(_.pick(state, SETTINGS_TO_STORE)), 500, { maxWait: 1000 })
for (const k of SETTINGS_TO_STORE)
    subscribeKey(state, k, storeSettings)

export function useSnapState() {
    return useSnapshot(state)
}

export function markVfsModified() {
    state.vfs = { ...state.vfs! }
    state.vfsModified = true
    reindexVfs()
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
    const originalId2vfsNode = new Map<string, VfsNodeAdmin>()
    if (clearMap)
        id2vfsNode.clear()
    recur(node, node.parent?.id || '/', node.parent)
    state.vfsShowDiskContentFor = ''
    // Reindex can update ids/references; remap caller-provided selections to canonical nodes from id2node.
    if (select)
        // Undo/redo swaps cloned trees; originalId keeps selection attached when id changed by rename/move
        state.selectedFiles = onlyTruthy(select.map(x =>
            id2vfsNode.get(typeof x === 'string' ? x : x.id)
            || originalId2vfsNode.get(typeof x === 'string' ? x : x.originalId)))

    function recur(node: VfsNodeAdmin, pre: string, parent: VfsNodeAdmin | undefined) {
        const oldId = node.id
        node.parent = parent
        node.inherited = getInheritedPerms(node) // refresh cached inheritance while reindexing, because local edits do not get a server roundtrip
        const newId = node.isRoot ? '/' : prefix(pre, pathEncode(node.name), node.type === 'folder' ? '/' : '')
        if (oldId && oldId !== newId)
            id2vfsNode.delete(oldId)
        node.id = newId
        node.originalId ||= newId // set only first value (all are truthy)
        id2vfsNode.set(newId, node)
        originalId2vfsNode.set(node.originalId, node)
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

    function getInheritedPerm(cursor: VfsNodeAdmin | undefined, perm: keyof VfsPerms): WhoVfs | undefined {
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

export function isDescendantUri(childUri: string, parentUri: string) {
    return parentUri.endsWith('/') && childUri.startsWith(parentUri)
}

export function prepareVfsUndo() {
    if (!state.vfs) return
    state.vfsUndo = cloneVfs(state.vfs)
}

export function undoVfs() {
    if (!state.vfs || !state.vfsUndo) return
    // Swap current/snapshot so pressing undo again restores the state we just replaced (single-level redo behavior).
    const current = cloneVfs(state.vfs)
    state.vfs = state.vfsUndo
    state.vfsUndo = current
    state.vfsModified = true
    reindexVfs()
}

// use this to reflect a deep change in an object to its root, so that valtio is triggered
export function updateStateObject(obj: any, k: string, cb: (x: any) => void) {
    obj[k] = produce(obj[k], cb)
}

function cloneVfs(node: VfsNodeAdmin): VfsNodeAdmin {
    const { parent, children, ...rest } = node
    // Parent links create cycles in the live tree; omit them so snapshots can be cloned and restored safely.
    const copy = _.cloneDeep(rest) as VfsNodeAdmin
    if (children)
        copy.children = children.map(cloneVfs)
    return copy
}

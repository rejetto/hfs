// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { proxy, useSnapshot } from 'valtio'
import { Dict } from './misc'
import { reindexVfs, VfsNodeAdmin } from './VfsPage'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { produce } from 'immer'

const STORAGE_KEY = 'admin_state'
const INIT = {
    title: '',
    config: {} as Dict,
    selectedFiles: [] as VfsNodeAdmin[],
    accountsAsTree: false,
    movingFile: '',
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

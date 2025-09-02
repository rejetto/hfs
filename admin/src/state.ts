// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { proxy, useSnapshot } from 'valtio'
import { Dict } from './misc'
import { VfsNode } from './VfsPage'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import produce from 'immer'

const STORAGE_KEY = 'admin_state'
const INIT = {
    title: '',
    config: {} as Dict,
    selectedFiles: [] as VfsNode[],
    accountsAsTree: false,
    movingFile: '',
    vfs: undefined as VfsNode | undefined,
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

// use this to reflect a deep change in an object to its root, so that valtio is triggered
export function updateStateObject(obj: any, k: string, cb: (x: any) => void) {
    obj[k] = produce(obj[k], cb)
}
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { proxy, useSnapshot } from 'valtio'
import { Dict } from './misc'
import { VfsNode } from './VfsPage'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'

const STORAGE_KEY = 'admin_state'
export const state = proxy<{
    title: string
    config: Dict
    vfs: VfsNode | undefined
    selectedFiles: VfsNode[]
    loginRequired: boolean | number
    username: string
    onlinePluginsColumns: Dict<boolean>
}>(Object.assign({
    title: '',
    config: {},
    selectedFiles: [],
    vfs: undefined,
    loginRequired: false,
    username: '',
    onlinePluginsColumns: {
        version: false,
        pushed_at: false,
        license: false,
    }
}, JSON.parse(localStorage[STORAGE_KEY]||null)))

const SETTINGS_TO_STORE: (keyof typeof state)[] = ['onlinePluginsColumns']
const storeSettings = _.debounce(() =>
    localStorage[STORAGE_KEY] = JSON.stringify(_.pick(state, SETTINGS_TO_STORE)), 500, { maxWait: 1000 })
for (const k of SETTINGS_TO_STORE)
    subscribeKey(state, k, storeSettings)

export function useSnapState() {
    return useSnapshot(state)
}

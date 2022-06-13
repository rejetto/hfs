// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { apiCall } from './api'
import { DirList } from './BrowseFiles'

export const state = proxy<{
    stopSearch?: ()=>void,
    stoppedSearch?: boolean,
    iconsClass: string,
    username: string,
    list: DirList,
    filteredList?: DirList,
    loading: boolean,
    error?: string,
    listReloader: number,
    patternFilter: string,
    showFilter: boolean,
    selected: Record<string,true>, // optimization: by using an object instead of an array, components are not rendered when the array changes, but only when their specific property change
    remoteSearch: string,
    sortBy: string,
    invertOrder: boolean,
    foldersFirst: boolean,
    theme: string,
    adminUrl?: string,
    serverConfig?: any,
    loginRequired?: boolean, // force user to login before proceeding
    messageOnly?: string, // no gui, just show this message
}>({
    iconsClass: '',
    username: '',
    list: [],
    filteredList: undefined,
    loading: false,
    listReloader: 0,
    patternFilter: '',
    showFilter: false,
    selected: {},
    remoteSearch: '',
    sortBy: 'name',
    invertOrder: false,
    foldersFirst: true,
    theme: '',
})

export function useSnapState() {
    return useSnapshot(state)
}

const SETTINGS_KEY = 'hfs_settings'
const SETTINGS_TO_STORE: (keyof typeof state)[] = ['sortBy','foldersFirst','theme']

loadSettings()
for (const k of SETTINGS_TO_STORE)
    subscribeKey(state, k, storeSettings)

// load server config
setTimeout(() =>
    apiCall('config', {}, { noModal: true }).then(res =>
        state.serverConfig = res) )

function loadSettings() {
    const json = localStorage.getItem(SETTINGS_KEY)
    if (!json) return
    let read
    try { read = JSON.parse(json) }
    catch {
        console.error('invalid settings stored', json)
        return
    }
    for (const k of SETTINGS_TO_STORE) {
        const v = read[k]
        if (v !== undefined) // @ts-ignore
            state[k] = v
    }
}

function storeSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(_.pick(state, SETTINGS_TO_STORE)))
}

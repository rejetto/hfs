// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DirList } from './BrowseFiles'

export const state = proxy<{
    stopSearch?: ()=>void,
    stoppedSearch?: boolean,
    iconsReady: boolean,
    username: string,
    list: DirList,
    filteredList?: DirList,
    loading: boolean,
    error?: string,
    listReloader: number,
    patternFilter: string,
    showFilter: boolean,
    selected: { [uri:string]: true }, // by using an object instead of an array, Entry components are not rendered when others get selected
    remoteSearch: string,
    sortBy: string,
    invertOrder: boolean,
    foldersFirst: boolean,
    sortNumerics: boolean,
    theme: string,
    adminUrl?: string,
    loginRequired?: boolean, // force user to login before proceeding
    messageOnly?: string, // no gui, just show this message
    can_upload?: boolean
    can_delete?: boolean
    accept?: string
}>({
    iconsReady: false,
    username: '',
    list: [],
    loading: false,
    listReloader: 0,
    patternFilter: '',
    showFilter: false,
    selected: {},
    remoteSearch: '',
    sortBy: 'name',
    invertOrder: false,
    foldersFirst: true,
    sortNumerics: false,
    theme: '',
})

export function useSnapState() {
    return useSnapshot(state)
}

const SETTINGS_KEY = 'hfs_settings'
const SETTINGS_TO_STORE: (keyof typeof state)[] = ['sortBy', 'sortNumerics', 'invertOrder', 'foldersFirst', 'theme']

loadSettings()
for (const k of SETTINGS_TO_STORE)
    subscribeKey(state, k, storeSettings)

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

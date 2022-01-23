import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { DirList } from './BrowseFiles'

export const state = proxy<{
    stopSearch?: ()=>void,
    stoppedSearch?: boolean,
    iconsClass: string,
    username: string,
    list: DirList,
    filteredList?: DirList,
    loading: boolean,
    error: Error | null,
    listReloader: number,
    patternFilter: string,
    showFilter: boolean,
    selected: Record<string,true>, // optimization: by using an object instead of an array, components are not rendered when the array changes, but only when their specific property change
    remoteSearch: string,
    sortBy: string,
    invertOrder: boolean,
    foldersFirst: boolean,
    theme: string,
}>({
    iconsClass: '',
    username: '',
    list: [],
    filteredList: undefined,
    loading: false,
    error: null,
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

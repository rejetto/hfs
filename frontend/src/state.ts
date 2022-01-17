import _ from 'lodash'
import { proxy, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'

export const state = proxy<{
    stopSearch?: ()=>void,
    stoppedSearch?: boolean,
    iconsClass: string,
    username: string,
    listFilter: string,
    remoteSearch: string,
    filteredEntries: number,
    sortBy: string,
    invertOrder: boolean,
    foldersFirst: boolean,
    theme: string,
}>({
    iconsClass: '',
    username: '',
    listFilter: '',
    remoteSearch: '',
    filteredEntries: -1,
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

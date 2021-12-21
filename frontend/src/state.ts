import { proxy, useSnapshot } from 'valtio'

export const state = proxy({
    iconsClass: '',
    username: '',
    listFilter: '',
    remoteSearch: '',
    filteredEntries: -1,
})

export function useSnapState() {
    return useSnapshot(state)
}

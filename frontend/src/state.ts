import { proxy, useSnapshot } from 'valtio'

export const state = proxy({
    username: '',
    listFilter: '',
    remoteSearch: '',
    filteredEntries: -1,
})

export function useSnapState() {
    return useSnapshot(state)
}

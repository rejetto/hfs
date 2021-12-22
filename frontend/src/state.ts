import { proxy, useSnapshot } from 'valtio'

export const state = proxy<{
    stopSearch?: ()=>void,
    iconsClass: string,
    username: string,
    listFilter: string,
    remoteSearch: string,
    filteredEntries: number,
}>({
    iconsClass: '',
    username: '',
    listFilter: '',
    remoteSearch: '',
    filteredEntries: -1,
})

export function useSnapState() {
    return useSnapshot(state)
}

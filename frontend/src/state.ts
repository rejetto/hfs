import { proxy, useSnapshot } from 'valtio'

export const state = proxy({
    username: ''
})

export function useSnapState() {
    return useSnapshot(state)
}

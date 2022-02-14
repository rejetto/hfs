import { proxy, useSnapshot } from 'valtio'
import { Dict } from './misc'
import { VfsNode } from './VfsPage'

export const state = proxy<{
    title: string
    config: Dict
    changes: Dict
    vfs: VfsNode | undefined
    selectedFiles: VfsNode[]
}>({
    title: '',
    config: {},
    changes: {},
    selectedFiles: [],
    vfs: undefined,
})

export function useSnapState() {
    return useSnapshot(state)
}

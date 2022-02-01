import { proxy, useSnapshot } from 'valtio'
import { Dict } from './misc'
import { Node } from './VfsPage'

export const state = proxy<{
    title: string
    config: Dict
    changes: Dict
    vfs: Node | undefined
    selectedFiles: Node[]
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

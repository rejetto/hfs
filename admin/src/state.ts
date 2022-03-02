// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

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

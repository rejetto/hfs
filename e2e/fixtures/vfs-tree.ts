import { createElement as h, useEffect } from 'react'
import VfsTree from '../../admin/src/VfsTree'
import { reindexVfs, state, useSnapState, undoVfs, VfsNodeAdmin } from '../../admin/src/state'

export default function VfsTreeFixture() {
    const { vfs } = useSnapState()
    useEffect(() => {
        const children = ['first', 'second', 'destination'].map(name => ({ name, type: 'folder' }))
        state.vfs = { name: '', isRoot: true, type: 'folder', children } as VfsNodeAdmin
        reindexVfs()
        state.selectedFiles = []
        state.expanded = ['/']
    }, [])
    return h('div', { style: { height: '80vh', display: 'flex', flexDirection: 'column' } },
        vfs && h(VfsTree, { statusApi: { data: { roots: {} } } as never, isSideBreakpoint: false }),
        h('output', { 'data-testid': 'tree-state' }, JSON.stringify(vfs?.children?.map(node =>
            [node.name, node.children?.map(child => child.name) || []]))),
        h('button', { onClick: undoVfs }, 'Undo fixture'))
}

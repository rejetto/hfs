import { createElement as h, useEffect } from 'react'
import { state, reindexVfs, useSnapState, VfsNodeAdmin } from '../../admin/src/state'
import VfsActionButtons from '../../admin/src/VfsActionButtons'
declare global { interface Window { moveFixture: { names: string[], destination: string[] } } }
export default function VfsMoveFixture() {
    const { vfs } = useSnapState()
    useEffect(() => {
        function node(name: string, children?: VfsNodeAdmin[]): VfsNodeAdmin {
            return { name, id: '', originalId: '', ...children && { type: 'folder', children } }
        }
        const { names, destination } = window.moveFixture
        state.vfs = { ...node('', names.map((name, i) => node('from' + i, [node(name)]))
            .concat(node('to', destination.map(name => node(name))))), isRoot: true }
        reindexVfs()
        state.movingFiles = state.vfs.children!.slice(0, -1).map(folder => folder.children![0].id)
    }, [])
    const destination = vfs?.children?.find(node => node.name === 'to')
    return h('div', {},
        h('output', { 'data-testid': 'tree' }, JSON.stringify(vfs?.children?.map(folder =>
            [folder.name, folder.children?.map(node => node.name) || []]))),
        destination && h(VfsActionButtons, { files: [destination], pasteTo: destination }))
}

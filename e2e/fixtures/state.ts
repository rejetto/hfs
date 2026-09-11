import { createElement as h, useEffect } from 'react'
import { reindexVfs, state, undoVfs, useSnapState, VfsNodeAdmin } from '../../admin/src/state'
import FileForm from '../../admin/src/FileForm'
import VfsActionButtons from '../../admin/src/VfsActionButtons'
import { useApiEx } from '../../admin/src/api'
import { useAccountsApi } from '../../admin/src/WhoField'
import VfsTree from '../../admin/src/VfsTree'

export default function StateFixture() {
    const snap = useSnapState()
    const statusApi = useApiEx('get_status')
    const accountsApi = useAccountsApi()
    useEffect(() => {
        state.vfs = { name: '', type: 'folder', isRoot: true, children: [
            { name: 'docs', type: 'folder', children: [{ name: 'file.txt', type: 'file' }] },
            { name: 'destination', type: 'folder' },
            { name: 'other', type: 'folder', children: [{ name: 'second.txt', type: 'file' }] },
        ] } as VfsNodeAdmin
        reindexVfs()
        state.selectedFiles = [state.vfs.children![0]]
        state.expanded = ['/', '/docs/']
    }, [])
    const folder = snap.vfs?.children?.[0]
    const destination = snap.vfs?.children?.[1]
    return h('div', {},
        new URLSearchParams(location.search).has('tree') && snap.vfs && h('div', { style: { height: 400, display: 'flex', flexDirection: 'column' } },
            h(VfsTree, { statusApi, isSideBreakpoint: false })),
        folder && h(FileForm, { file: folder, statusApi, accountsApi, isSideBreakpoint: true }),
        folder && destination && h('section', { 'data-testid': 'actions' },
            h(VfsActionButtons, { files: folder.children || [], pasteTo: destination })),
        folder && destination && h('section', { 'data-testid': 'multiple' },
            h(VfsActionButtons, { files: [...folder.children || [], ...snap.vfs?.children?.[2].children || []], pasteTo: destination })),
        h('button', { onClick: undoVfs }, 'Undo fixture'),
        h('output', { 'data-testid': 'state' }, JSON.stringify({
            cut: snap.movingFiles, folder: folder?.id, expanded: snap.expanded,
            destination: destination?.children?.map(x => x.name).sort(),
        })))
}

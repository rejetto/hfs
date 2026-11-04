import { createElement as h } from 'react'
import FileForm from '../../admin/src/FileForm'
import { useApiEx } from '../../admin/src/api'
import { useAccountsApi } from '../../admin/src/WhoField'
import type { VfsNodeAdmin } from '../../admin/src/state'

declare global { interface Window { fileFormUri: string, fileFormNode?: VfsNodeAdmin } }
export default function FileFormFixture() {
    const statusApi = useApiEx('get_status')
    const accountsApi = useAccountsApi()
    return h(FileForm, { file: window.fileFormNode ?? { id: window.fileFormUri, name: 'report.txt', type: 'file' },
        statusApi, accountsApi, isSideBreakpoint: false })
}

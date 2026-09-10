import { createElement as h } from 'react'
import FileForm from '../../admin/src/FileForm'
import { useApiEx } from '../../admin/src/api'
import { useAccountsApi } from '../../admin/src/WhoField'

declare global { interface Window { fileFormUri: string } }
export default function FileFormFixture() {
    const statusApi = useApiEx('get_status')
    const accountsApi = useAccountsApi()
    return h(FileForm, { file: { id: window.fileFormUri, name: 'report.txt', type: 'file' },
        statusApi, accountsApi, isSideBreakpoint: false })
}

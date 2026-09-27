import { createElement as h } from 'react'
import { useApiList } from '../../admin/src/api'

export default function ListReconnectFixture() {
    const query = new URLSearchParams(location.search)
    const { list, error, reload } = useApiList(query.get('cmd') || 'get_plugins', { file: query.get('file') }, {
        reconnectGraceSeconds: query.has('window') ? Number(query.get('window')) : undefined,
    })
    return h('div', {}, h('button', { onClick: reload }, 'Reload fixture'),
        h('output', { 'data-testid': 'error' }, error),
        h('pre', { 'data-testid': 'list' }, JSON.stringify(list)))
}

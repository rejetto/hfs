import { createElement as h, useState } from 'react'
import { useApiList } from '../../admin/src/api'

export default function ApiListFixture() {
    const [file, setFile] = useState('first')
    const result = useApiList('get_log', { file })
    return h('div', {},
        h('button', { onClick: () => setFile('second') }, 'Second stream'),
        h('button', { onClick: result.reload }, 'Reload stream'),
        h('output', { 'data-testid': 'error' }, result.error),
        h('output', { 'data-testid': 'list' }, JSON.stringify(result.list)),
        h('div', { 'data-testid': 'element' }, result.element))
}

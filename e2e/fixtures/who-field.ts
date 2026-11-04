import { createElement as h, useState } from 'react'
import { WhoField } from '../../admin/src/WhoField'
import { WhoVfs } from '../../src/cross'

export default function WhoFieldFixture() {
    const [value, setValue] = useState<WhoVfs>({ this: ['alice'], children: false })
    return h('div', {},
        h(WhoField, { label: 'Download', value, onChange: setValue, isDir: true, inherit: true }),
        h('output', { 'data-testid': 'permission' }, JSON.stringify(value)))
}

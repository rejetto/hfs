import { createElement as h, useState } from 'react'
import AcmeForm from '../../admin/src/AcmeForm'
export default function AcmeFixture() {
    const [complete, setComplete] = useState(0)
    return h('div', {},
        h(AcmeForm, { fresh: () => false, checkDomain: async () => { throw Error('DNS must not check the HTTP domain') }, onComplete: () => setComplete(x => x + 1) }),
        h('output', {}, 'completed=' + complete))
}

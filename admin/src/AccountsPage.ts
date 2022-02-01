import { isValidElement, createElement as h } from "react"
import { useApiComp } from './api'

export default function AccountsPage() {
    const [res] = useApiComp('get_usernames')
    if (isValidElement(res))
        return res
    return h('ul', {},
        res.list.map((x: string) =>
            h('li', { key: x }, x)))
}

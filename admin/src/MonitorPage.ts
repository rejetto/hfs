import _ from "lodash"
import { isValidElement, createElement as h } from "react"
import { useApiComp } from "./api"
import { Refresh } from '@mui/icons-material'
import { Button } from '@mui/material'

export default function MonitorPage() {
    const [res, reload] = useApiComp('get_status')
    if (isValidElement(res))
        return res
    return h('div', {},
        h(Button, { onClick: reload, startIcon:h(Refresh) }, 'Reload'),
        h('ul', {},
            pair('started'),
            pair('http', 'HTTP', v => v.active ? 'port '+v.port : 'off'),
            pair('https', 'HTTPS', v => v.active ? 'port '+v.port : 'off'),
        )
    )

    function pair(k: string, label: string='', render?:(v:any) => string) {
        let v = _.get(res, k)
        if (v === undefined)
            return null
        if (typeof v === 'string' && isoDateRe.test(v))
            v = new Date(v).toLocaleString()
        if (render)
            v = render(v)
        if (!label)
            label = _.capitalize(k.replaceAll('_', ' '))
        return h('li', {}, label + ': ' + v)
    }
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

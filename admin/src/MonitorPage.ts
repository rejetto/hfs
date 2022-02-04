import _ from "lodash"
import { isValidElement, createElement as h } from "react"
import { useApiComp } from "./api"
import { Lock, Refresh } from '@mui/icons-material'
import { Button, Grid } from '@mui/material'
import { DataGrid } from "@mui/x-data-grid"

export default function MonitorPage() {
    const [res, reload] = useApiComp('get_status')
    if (isValidElement(res))
        return res
    return h('div', { flex: 1, display: 'flex', flexDirection: 'column' },
        h('div', {},
            h(Button, { onClick: reload, startIcon:h(Refresh) }, 'Reload') ),
        h(Grid, { container: true, flex: 1 },
            h(Grid, { item: true, md: 6 },
                h('ul', {},
                    pair('started'),
                    pair('http', 'HTTP', v => v.active ? 'port '+v.port : 'off'),
                    pair('https', 'HTTPS', v => v.active ? 'port '+v.port : 'off'),
                ) ),
            h(Grid, { item: true, md: 6 },
                h(Connections))
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

function Connections() {
    const [res] = useApiComp('get_connections')
    if (isValidElement(res))
        return res
    const { list } = res
    const rows = list.map((x:any,id:number) => ({ id, ...x }))
    return h(DataGrid, {
        pageSize: 25,
        columns: [
            {
                field: 'ip',
                headerName: 'IP',
                flex: 1,
                valueGetter: ({ row, value }) => (row.v === 6 ? `[${value}]` : value) + ' :' + row.port
            },
            {
                field: 'v',
                headerName: 'Protocol',
                renderCell: ({ value, row }) => h('span', {}, 'IPv' + value, row.secure && h(Lock))
            },
            {
                field: 'started',
                valueGetter: ({ value }) => new Date(value).toLocaleTimeString()
            },
        ],
        rows,
    })
}

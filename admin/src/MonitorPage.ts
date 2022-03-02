// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from "lodash"
import { isValidElement, createElement as h, useMemo, Fragment } from "react"
import { apiCall, useApiComp, useApiList } from "./api"
import { Delete, Lock, Refresh } from '@mui/icons-material'
import { Box, Grid, Typography } from '@mui/material'
import { DataGrid } from "@mui/x-data-grid"
import { Alert } from '@mui/material'
import { formatBytes, IconBtn, iconTooltip } from "./misc"
import { alertDialog } from "./dialog"
import { prefix } from './misc'

export default function MonitorPage() {
    return h(Box, { flex: 1, display: 'flex', flexDirection: 'column' },
        h(Grid, { container: true, flex: 1 },
            h(Grid, { item: true, md: 3, lg: 4, xl: 6 },
                h(MoreInfo) ),
            h(Grid, { item: true, md: 9, lg: 8, xl: 6, width: '100%', display: 'flex', flexDirection: 'column' },
                h(SectionTitle, {}, "Active connections"),
                h(Connections))
        )
    )
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function SectionTitle(props: object) {
    return h(Typography, { variant: 'h4', px: 2, ...props })
}

function MoreInfo() {
    const [res, reload] = useApiComp('get_status')
    return h(Box, {},
        h(SectionTitle, {}, "Status", h(IconBtn, { sx: { ml: 2 }, icon: Refresh, onClick: reload })),
        isValidElement(res) ? res :
            h('ul', {},
                pair('started'),
                pair('version'),
                pair('build'),
                pair('http', 'HTTP', v => v.listening ? 'port '+v.port : ('off' + prefix(': configured port is used by ',v.busy))),
                pair('https', 'HTTPS', v => v.listening ? 'port '+v.port : ('off' + prefix(': configured port is used by ',v.busy))),
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

function Connections() {
    const { list, error } = useApiList('get_connections')
    const rows = useMemo(()=> list?.map((x:any,id:number) => ({ id, ...x })), [list])
    if (error)
        return h(Alert, { severity: 'error' }, error)
    return h(DataGrid, {
        pageSize: 25,
        columns: [
            {
                field: 'ip',
                headerName: 'Address',
                flex: 1,
                valueGetter: ({ row, value }) => (row.v === 6 ? `[${value}]` : value) + ' :' + row.port
            },
            {
                field: 'v',
                headerName: 'Protocol',
                align: 'center',
                renderCell: ({ value, row }) => h(Fragment, {},
                    'IPv' + value,
                    row.secure && iconTooltip(Lock, "HTTPS", { opacity:.5 })
                )
            },
            {
                field: 'outSpeed',
                headerName: 'Speed',
                valueGetter: ({ value }) => formatBytes(value*1000, 'B/s', 1000)
            },
            {
                field: 'sent',
                headerName: 'Total',
                valueGetter: ({ value }) => formatBytes(value)
            },
            {
                field: 'started',
                headerName: 'Started',
                valueGetter: ({ value }) => new Date(value).toLocaleTimeString()
            },
            {
                field: 'Actions ',
                width: 80,
                align: 'center',
                renderCell({ row }) {
                    return h(IconBtn, {
                        icon: Delete,
                        title: 'Disconnect',
                        onClick() {
                            apiCall('disconnect', _.pick(row, ['ip', 'port'])).catch(alertDialog)
                        }
                    })
                }
            }
        ],
        rows,
    })
}

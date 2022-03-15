// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from "lodash"
import { isValidElement, createElement as h, useMemo, Fragment, useState } from "react"
import { apiCall, useApiComp, useApiList } from "./api"
import { PauseCircle, PlayCircle, Delete, Lock, Block } from '@mui/icons-material'
import { Box, Chip } from '@mui/material'
import { DataGrid } from "@mui/x-data-grid"
import { Alert } from '@mui/material'
import { formatBytes, IconBtn, iconTooltip, manipulateConfig } from "./misc"
import { Field, SelectField } from './Form'

export default function MonitorPage() {
    return h(Fragment, {},
        h(MoreInfo),
        h(Connections),
    )
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function MoreInfo() {
    const [res] = useApiComp('get_status')
    return h(Fragment, {},
        isValidElement(res) ? res :
            h(Box, { display: 'flex', flexWrap: 'wrap', gap: '1em', mb: 2 },
                pair('started'),
                pair('version'),
                pair('build'),
                pair('http', "HTTP", port),
                pair('https', "HTTPS", port),
            )
    )

    type Color = Parameters<typeof Chip>[0]['color']
    type Render = (v:any) => [string, Color?]

    function pair(k: string, label: string='', render?:Render) {
        let v = _.get(res, k)
        if (v === undefined)
            return null
        if (typeof v === 'string' && isoDateRe.test(v))
            v = new Date(v).toLocaleString()
        let color: Color = undefined
        if (render)
            [v, color] = render(v)
        if (!label)
            label = _.capitalize(k.replaceAll('_', ' '))
        return h(Chip, {
            variant: 'filled',
            color,
            label: h(Fragment, {}, h('b',{},label), ': ', v),
        })
    }

    function port(v: any): ReturnType<Render> {
        return v.listening ? ["port " + v.port, 'success']
            : v.error ? [v.error, 'error']
                : ["off"]
    }

}

function Connections() {
    const { list, error } = useApiList('get_connections')
    const [filtered, setFiltered] = useState(true)
    const [paused, setPaused] = useState(false)
    const rows = useMemo(()=>
        list?.filter((x:any) => !filtered || x.path).map((x:any,id:number) => ({ id, ...x })),
        [!paused && list, filtered]) //eslint-disable-line
    return h(Fragment, {},
        h(Box, { display: 'flex', alignItems: 'center' },
            h(SelectField as Field<boolean>, {
                fullWidth: false,
                value: filtered,
                onChange: setFiltered,
                options: { "Downloads connections": true, "All connections": false }
            }),

            h(Box, { flex: 1 }),
            h(IconBtn, {
                title: paused ? "Resume" : "Pause",
                icon: paused ? PlayCircle : PauseCircle,
                sx: { mr: 1 },
                onClick() {
                    setPaused(!paused)
                }
            }),
        ),
        error ? h(Alert, { severity: 'error' }, error) :
            h(DataGrid, {
                pageSize: 25,
                rows,
                columns: [
                    {
                        field: 'ip',
                        headerName: "Address",
                        flex: 1,
                        maxWidth: 400,
                        valueGetter: ({ row, value }) => (row.v === 6 ? `[${value}]` : value) + ' :' + row.port
                    },
                    {
                        field: 'started',
                        headerName: "Started",
                        width: 130,
                        valueGetter: ({ value }) => new Date(value).toLocaleTimeString()
                    },
                    {
                        field: 'path',
                        headerName: "File",
                        flex: 1,
                        renderCell: ({ value }) => {
                            if (!value) return
                            const i = value?.lastIndexOf('/')
                            return h(Fragment, {}, value.slice(i + 1),
                                i > 0 && h(Box, { ml: 2, color: 'text.secondary' }, value.slice(0, i)))
                        }
                    },
                    {
                        field: 'v',
                        headerName: "Protocol",
                        align: 'center',
                        hide: true,
                        renderCell: ({ value, row }) => h(Fragment, {},
                            "IPv" + value,
                            row.secure && iconTooltip(Lock, "HTTPS", { opacity: .5 })
                        )
                    },
                    {
                        field: 'outSpeed',
                        headerName: "Speed",
                        valueGetter: ({ value }) => value ? formatBytes(value * 1000, "B/s", 1000) : ''
                    },
                    {
                        field: 'sent',
                        headerName: "Total",
                        valueGetter: ({ value }) => formatBytes(value)
                    },
                    {
                        field: "Actions ",
                        width: 80,
                        align: 'center',
                        renderCell({ row }) {
                            return h('div', {},
                                h(IconBtn, {
                                    icon: Delete,
                                    title: "Disconnect",
                                    onClick: () => apiCall('disconnect', _.pick(row, ['ip', 'port'])),
                                }),
                                h(IconBtn, {
                                    icon: Block,
                                    title: "Block IP",
                                    onClick: () => blockIp(row.ip),
                                }),
                            )
                        }
                    }
                ]
            })
    )
}

function blockIp(ip: string) {
    return manipulateConfig('block', data => [...data, { ip }])
}

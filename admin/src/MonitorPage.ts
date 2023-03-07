// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from "lodash"
import { createElement as h, useMemo, Fragment, useState } from "react"
import { apiCall, useApiEvents, useApiEx, useApiList } from "./api"
import { PauseCircle, PlayCircle, Delete, Lock, Block, FolderZip, Upload } from '@mui/icons-material'
import { Alert, Box, Chip, ChipProps } from '@mui/material'
import { DataGrid } from "@mui/x-data-grid"
import { formatBytes, IconBtn, IconProgress, iconTooltip, manipulateConfig, useBreakpoint } from "./misc"
import { Field, SelectField } from '@hfs/mui-grid-form'
import { GridColumns } from '@mui/x-data-grid/models/colDef/gridColDef'
import { StandardCSSProperties } from '@mui/system/styleFunctionSx/StandardCssProperties'

export default function MonitorPage() {
    return h(Fragment, {},
        h(MoreInfo),
        h(Connections),
    )
}

const isoDateRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function MoreInfo() {
    const { data: status, element } = useApiEx('get_status')
    const { data: connections } = useApiEvents('get_connection_stats')
    if (status && connections)
        Object.assign(status, connections)
    const md = useBreakpoint('md')
    const sm = useBreakpoint('sm')
    return element || h(Box, { display: 'flex', flexWrap: 'wrap', gap: '1em', mb: 2 },
        md && pair('started'),
        md && pair('http', { label: "HTTP", render: port }),
        md && pair('https', { label: "HTTPS", render: port }),
        sm && pair('connections'),
        pair('sent', { render: formatBytes, minWidth: '4em' }),
        sm && pair('got', { render: formatBytes, minWidth: '4em' }),
        pair('outSpeed', { label: "Output speed", render: formatSpeed }),
    )

    type Color = ChipProps['color']
    type Render = (v: any) => [string, Color?] | string
    interface PairOptions {
        label?: string
        render?: Render
        minWidth?: StandardCSSProperties['minWidth']
    }

    function pair(k: string, { label, minWidth, render }: PairOptions={}) {
        let v = _.get(status, k)
        if (v === undefined)
            return null
        if (typeof v === 'string' && isoDateRe.test(v))
            v = new Date(v).toLocaleString()
        let color: Color = undefined
        if (render) {
            v = render(v)
            if (Array.isArray(v))
                [v, color] = v
        }
        if (!label)
            label = _.capitalize(k.replaceAll('_', ' '))
        return h(Chip, {
            variant: 'filled',
            color,
            label: h(Fragment, {},
                h('b',{},label),
                ': ',
                h('span', { style:{ display: 'inline-block', minWidth } }, v),
            ),
        })
    }

    function port(v: any): ReturnType<Render> {
        return v.listening ? ["port " + v.port, 'success']
            : v.error ? [v.error, 'error']
                : "off"
    }

}

function Connections() {
    const { list, error, props } = useApiList('get_connections')
    const [filtered, setFiltered] = useState(true)
    const [paused, setPaused] = useState(false)
    const rows = useMemo(() =>
            list?.filter((x: any) => !filtered || x.path).map((x: any, id: number) => ({ id, ...x })),
        [!paused && list, filtered]) //eslint-disable-line
    // if I don't memo 'columns', it won't keep hiding status
    const columns = useMemo<GridColumns<any>>(() => [
        {
            field: 'ip',
            headerName: "Address",
            flex: 1,
            maxWidth: 400,
            valueGetter: ({ row, value }) => (row.v === 6 ? `[${value}]` : value) + ' :' + row.port
        },
        {
            field: 'user',
            headerName: "User",
        },
        {
            field: 'started',
            headerName: "Started",
            type: 'dateTime',
            width: 130,
            valueFormatter: ({ value }) => new Date(value as string).toLocaleTimeString()
        },
        {
            field: 'path',
            headerName: "File",
            flex: 1,
            renderCell({ value, row }) {
                if (!value) return
                if (row.archive)
                    return h(Fragment, {},
                        h(FolderZip, { sx: { mr: 1 } }),
                        row.archive,
                        h(Box, { ml: 2, color: 'text.secondary' }, value)
                    )
                const i = value?.lastIndexOf('/')
                return h(Fragment, {},
                    row.uploadProgress !== undefined
                        && h(IconProgress, { icon: Upload, progress: row.uploadProgress, sx: { mr: 1 } }),
                    value.slice(i + 1),
                    i > 0 && h(Box, { ml: 2, color: 'text.secondary' }, value.slice(0, i))
                )
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
            type: 'number',
            renderCell: ({ value, row }) => formatSpeed(Math.max(value||0, row.inSpeed||0))
        },
        {
            field: 'sent',
            headerName: "Total",
            type: 'number',
            renderCell: ({ value, row}) => formatBytes(Math.max(value||0, row.got||0))
        },
        {
            field: 'agent',
            headerName: "Agent",
        },
        {
            field: "Actions",
            width: 80,
            align: 'center',
            hideSortIcons: true,
            disableColumnMenu: true,
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
                        disabled: row.ip === props?.you,
                        onClick: () => blockIp(row.ip),
                    }),
                )
            }
        }
    ], [props])
    return h(Fragment, {},
        h(Box, { display: 'flex', alignItems: 'center' },
            h(SelectField as Field<boolean>, {
                fullWidth: false,
                value: filtered,
                onChange: setFiltered as any,
                options: { "Show only files": true, "Show all connections": false }
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
        error ? h(Alert, { severity: 'error' }, error)
            : h(DataGrid, { rows, columns,
                localeText: filtered ? { noRowsLabel: "No downloads at the moment" } : undefined,
            })
    )
}

function blockIp(ip: string) {
    return manipulateConfig('block', data => [...data, { ip }])
}

function formatSpeed(value: number) {
    return !value ? '' : formatBytes(value * 1000, { post: "B/s", k: 1000, digits: 1 })
}

function isLocalHost(ip: string) {
    return ip === '::1' || ip.endsWith('127.0.0.1')
}
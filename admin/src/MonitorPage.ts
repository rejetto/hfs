// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from "lodash"
import { createElement as h, useMemo, Fragment, useState } from "react"
import { apiCall, useApiEvents, useApiEx, useApiList } from "./api"
import { LinkOff, Lock, FolderZip, Upload, Download, ChevronRight, ChevronLeft } from '@mui/icons-material'
import { Box, Chip, ChipProps } from '@mui/material'
import { DataTable } from './DataTable'
import {
    formatBytes, ipForUrl, CFG, formatSpeed, with_, createDurationFormatter, formatTimestamp, formatPerc, md, Callback,
    reactJoin,
} from "./misc"
import { IconBtn, IconProgress, iconTooltip, usePauseButton, useBreakpoint, Country, hTooltip } from './mui'
import { Field, SelectField } from '@hfs/mui-grid-form'
import { StandardCSSProperties } from '@mui/system/styleFunctionSx/StandardCssProperties'
import { agentIcons } from './LogsPage'
import { state, useSnapState } from './state'
import { useBlockIp } from './useBlockIp'
import { alertDialog } from './dialog'

export default function MonitorPage() {
    return h(Fragment, {},
        h(MoreInfo),
        h(Connections),
    )
}

function MoreInfo() {
    const { data: status, element } = useApiEx('get_status')
    const { data: connections } = useApiEvents('get_connection_stats')
    if (status && connections)
        Object.assign(status, connections)
    const [allInfo, setAllInfo] = useState(false)
    const lg = useBreakpoint('lg')
    const md = useBreakpoint('md')
    const sm = useBreakpoint('sm')
    const formatDuration = createDurationFormatter({ maxTokens: 2, skipZeroes: true })
    return element || h(Box, { display: 'flex', flexWrap: 'wrap', gap: { xs: .5, md: 1 }, mb: { xs: 1, sm: 2 } },
        (allInfo || md) && pair('started', {
            label: "Uptime",
            render: x => formatDuration(Date.now() - +new Date(x)),
            title: x => "Started: " + formatTimestamp(x),
        }),
        (allInfo || sm) && pair('sent_got', {
            render: x => ({ Sent: formatBytes(x[0]), Got: formatBytes(x[1]) }),
            onDelete: () => apiCall('clear_persistent', { k: ['totalSent', 'totalGot'] })
                .then(() => alertDialog("Done", 'success'), alertDialog)
        }),
        (allInfo || sm) && pair('ips', { label: "IPs" }),
        pair('outSpeed', { label: "Output", render: formatSpeedK, minWidth: '8.5em' }),
        pair('inSpeed', { label: "Input", render: formatSpeedK, minWidth: '8.5em' }),
        (md || allInfo && md || status?.http?.error) && pair('http', { label: "HTTP", render: port }),
        (md || allInfo && md || status?.https?.error) && pair('https', { label: "HTTPS", render: port }),
        !md && h(IconBtn, {
            size: 'small',
            icon: allInfo ? ChevronLeft : ChevronRight,
            title: "Show more",
            onClick: () => setAllInfo(x => !x)
        }),
    )

    type Color = ChipProps['color']
    type Render = (v: any) => [string, Color?] | string | { [label: string]: string }
    interface PairOptions {
        label?: string
        render?: Render
        minWidth?: StandardCSSProperties['minWidth']
        title?: (v: any) => string
        onDelete?: Callback
    }

    function pair(k: string, { label, minWidth, render, title, onDelete }: PairOptions={}) {
        let v = _.get(status, k)
        if (v === undefined)
            return null
        let color: Color = undefined
        const renderedTitle = title?.(v)
        if (render) {
            v = render(v)
            if (Array.isArray(v))
                [v, color] = v
        }
        if (!label)
            label = _.capitalize(k.replaceAll('_', ' '))
        return hTooltip(renderedTitle, undefined, h(Chip, {
            variant: 'filled',
            color,
            onDelete,
            label: reactJoin(' – ', _.map(_.isPlainObject(v) ? v : { [label]: v }, (v,label) =>
                h('span', { style:{ display: 'inline-block', minWidth } },
                    h('b',{}, label), ': ', v,
                ))),
        }) )
    }

    function port(v: any): ReturnType<Render> {
        return v.listening ? ["port " + v.port, 'success']
            : v.error ? [v.error, 'error']
                : "off"
    }

}

function Connections() {
    const { list, error, props } = useApiList('get_connections')
    const config = useApiEx('get_config', { only: [CFG.geo_enable] })
    const { monitorOnlyFiles } = useSnapState()
    const { pause, pauseButton } = usePauseButton()
    const rows = useMemo(() =>
            list?.filter((x: any) => !monitorOnlyFiles || x.op).map((x: any, id: number) => ({ id, ...x })),
        [!pause && list, monitorOnlyFiles]) //eslint-disable-line
    const blockIp = useBlockIp()
    return h(Fragment, {},
        h(Box, { display: 'flex', alignItems: 'center' },
            h(SelectField as Field<boolean>, {
                fullWidth: false,
                value: monitorOnlyFiles,
                onChange: v => state.monitorOnlyFiles = v,
                options: { "Show only files": true, "Show all connections": false }
            }),
        ),
        h(DataTable, {
            error,
            rows,
            noRows: monitorOnlyFiles && "No downloads at the moment",
            addToFooter: pauseButton,
            columns: [
                {
                    field: 'ip',
                    headerName: "Address",
                    flex: 1,
                    maxWidth: 400,
                    renderCell: ({ row, value }) => ipForUrl(value) + ' :' + row.port,
                    mergeRender: { other: 'user', fontSize: 'small' },
                },
                {
                    field: 'country',
                    hidden: config.data?.[CFG.geo_enable] !== true,
                    headerName: "Country",
                    hideUnder: 'md',
                    renderCell: ({ value, row }) => h(Country, { code: value, ip: row.ip, def: '-' }),
                },
                {
                    field: 'user',
                    headerName: "User",
                    hideUnder: 'md',
                },
                {
                    field: 'started',
                    headerName: "Started",
                    type: 'dateTime',
                    width: 96,
                    hideUnder: 'lg',
                    valueFormatter: ({ value }) => new Date(value as string).toLocaleTimeString()
                },
                {
                    field: 'path',
                    headerName: "File",
                    flex: 1.5,
                    renderCell({ value, row }) {
                        if (!value || !row.op) return
                        if (row.op === 'browsing')
                            return h(Box, {}, value, h(Box, { fontSize: 'x-small' }, "browsing"))
                        return h(Fragment, {},
                            h(IconProgress, {
                                icon: row.archive ? FolderZip : row.op === 'upload' ? Upload : Download,
                                progress: row.opProgress ?? row.opOffset,
                                offset: row.opOffset,
                                title: md(formatPerc(row.opProgress) + (row.opTotal ? "\nTotal: " + formatBytes(row.opTotal) : '')),
                                sx: { mr: 1 }
                            }),
                            row.archive ? h(Box, {}, value, h(Box, { fontSize: 'x-small', color: 'text.secondary' }, row.archive))
                                : with_(value?.lastIndexOf('/'), i => h(Box, {}, value.slice(i + 1),
                                    i > 0 && h(Box, { fontSize: 'x-small', color: 'text.secondary' }, value.slice(0, i))
                                )),
                        )
                    }
                },
                {
                    field: 'outSpeed',
                    headerName: "Speed",
                    width: 110,
                    hideUnder: 'sm',
                    type: 'number',
                    renderCell: ({ value, row }) => formatSpeedK(Math.max(value||0, row.inSpeed||0) || undefined),
                    mergeRender: { other: 'sent', fontSize: 'small', textAlign: 'right' }
                },
                {
                    field: 'sent',
                    headerName: "Sent",
                    type: 'number',
                    hideUnder: 'md',
                    renderCell: ({ value, row}) => formatBytes(Math.max(value||0, row.got||0))
                },
                {
                    field: 'v',
                    headerName: "Protocol",
                    align: 'center',
                    hideUnder: Infinity,
                    renderCell: ({ value }) => h(Fragment, {},
                        "IPv" + value,
                        iconTooltip(Lock, "HTTPS", { opacity: .5 })
                    )
                },
                {
                    field: 'agent',
                    headerName: "Agent",
                    hideUnder: 'lg',
                    renderCell: ({ value }) => agentIcons(value)
                },
            ],
            actionsProps: { hideUnder: 'sm' },
            actions: ({ row }) => [
                h(IconBtn, {
                    icon: LinkOff,
                    title: "Disconnect",
                    doneMessage: true,
                    onClick: () => apiCall('disconnect', _.pick(row, ['ip', 'port'])).then(x => x.result > 0)
                }),
                blockIp.iconBtn(row.ip, "From monitoring", { disabled: row.ip === props?.you }),
            ]
        })
    )
}

function formatSpeedK(value: number | undefined) {
    return value === undefined ? '' : formatSpeed(value * 1000, { digits: 1 })
}

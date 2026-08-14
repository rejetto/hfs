// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from "lodash"
import { createElement as h, useMemo, Fragment, useState, type CSSProperties } from "react"
import { language, t, translateText } from './i18n'
import { apiCall, useApiEvents, useApiEx, useApiList } from "./api"
import { LinkOff as DisconnectIcon, Lock, FolderZip, Upload, Download, ChevronRight, ChevronLeft, History } from '@mui/icons-material'
import { Alert, Box, Chip, ChipProps, Grid } from '@mui/material'
import { DataTable } from './DataTable'
import {
    formatBytes, ipForUrl, CFG, formatSpeed, with_, createDurationFormatter, formatTimestamp, formatPerc, md, Callback,
    reactJoin, SPECIAL_URI,
} from "./misc"
import {
    fillFlexParentSx, IconBtn, IconProgress, iconTooltip, usePauseButton, useBreakpoint, Country, hTooltip, useToggleButton, Flex, Btn
} from './mui'
import { Field, SelectField } from '@hfs/mui-grid-form'
import { LogFile } from './LogsPage'
import { agentIcons } from './agentIcons'
import { state, useSnapState } from './state'
import { BlockIpBtn } from './blockIp'
import { alertDialog, confirmDialog, toast } from './dialog'
import { useInterval } from 'usehooks-ts'
import { PageProps } from './App'
import { adminApis } from '../../src/adminApis'

export default function MonitorPage({ setTitleSide }: PageProps) {
    setTitleSide(useMemo(() =>
            h(Alert, { severity: 'info', sx: { display: { xs: 'none', sm: 'inherit' }  } }, t`proxy_connections_notice`),
        []))
    return h(Fragment, {},
        h(MoreInfo),
        h(Connections),
    )
}

function MoreInfo() {
    const { data: status, element, reload } = useApiEx<typeof adminApis.get_status>('get_status')
    useInterval(reload, 10_000) // status hardly change, but it can
    const { data: stats } = useApiEvents('get_connection_stats')
    const [allInfo, setAllInfo] = useState(false)
    const md = useBreakpoint('md')
    const sm = useBreakpoint('sm')
    const xl = useBreakpoint('xl')
    const formatDuration = createDurationFormatter({ locale: language, maxTokens: 2, skipZeroes: true })
    return element || h(Box, { sx: { display: 'flex', flexWrap: 'wrap', gap: { xs: .5, md: 1 }, mb: { xs: 1, sm: 2 } } },
        (allInfo || md) && pair('started', {
            label: t`Uptime`,
            render: x => formatDuration(Date.now() - +new Date(x)),
            title: x => t('started_at_colon', { startedAt: formatTimestamp(x) }),
        }),
        (allInfo || sm) && pair('sent_got', {
            render: x => ({ [t`Sent`]: formatBytes(x[0]), [t`Got`]: formatBytes(x[1]) }),
            title: x => t('since_timestamp', { timestamp: formatTimestamp(x[2]) }),
            onDelete: () => confirmDialog(t`Reset stats?`)
                .then(yes => yes && apiCall('clear_persistent', { k: ['totalSent', 'totalGot'] })
                    .then(() => alertDialog(t`Done`, 'success'), alertDialog))
        }),
        pair('outSpeedKb', { label: t`Outgoing traffic`, render: formatSpeedK, minWidth: '8.5em' }),
        pair('inSpeedKb', { label: t`Input`, render: formatSpeedK, minWidth: '8.5em' }),
        (allInfo || sm) && pair('ips', { label: t`IPs`, title: () => stats && t('connections_count', {
            n: stats.connections,
            count: stats.connections.toLocaleString(language),
        }) }),
        (md || allInfo || status?.http?.error) && pair('http', { label: t`HTTP`, render: port }),
        (md || allInfo || status?.https?.error) && pair('https', { label: t`HTTPS`, render: port }),
        (xl || allInfo) && pair('ram', { label: t`RAM`, render: formatBytes }),
        !xl && h(IconBtn, {
            size: 'small',
            icon: allInfo ? ChevronLeft : ChevronRight,
            title: t`Show more`,
            onClick: () => setAllInfo(x => !x)
        }),
    )

    type Color = ChipProps['color']
    type Render = (v: any) => [string, Color?] | string | { [label: string]: string }

    interface PairOptions {
        label?: string
        render?: Render
        minWidth?: CSSProperties['minWidth']
        title?: (v: any) => string
        onDelete?: Callback
    }

    function pair(k: string, { label, minWidth, render, title, onDelete }: PairOptions = {}) {
        let v = _.get(stats, k) ?? _.get(status, k)
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
            label = translateText(_.capitalize(k.replaceAll('_', ' ')))
        return hTooltip(renderedTitle, undefined, h(Chip, {
            variant: 'filled',
            color,
            onDelete,
            label: reactJoin(' – ', _.map(_.isPlainObject(v) ? v : { [label]: v }, (v, label) =>
                h('span', { style: { display: 'inline-block', minWidth } },
                    h('b', {}, label), ': ', v,
                ))),
        }))
    }

    function port(v: any): ReturnType<Render> {
        return v.listening ? ["port " + v.port, 'success']
            : v.error ? [v.error, 'error']
                : "off"
    }

}

function Connections() {
    const { list, error, props, initializing } = useApiList('get_connections')
    const config = useApiEx('get_config', { only: [CFG.geo_enable] })
    const { monitorOnlyFiles } = useSnapState()
    const { pause, pauseButton } = usePauseButton()
    const rows = useMemo(() =>
        (!monitorOnlyFiles ? list : list?.filter((x: any) => x.op)) ?? [],
        [!pause && list, monitorOnlyFiles]) //eslint-disable-line
    const logAble = useBreakpoint('md')
    const [wantLog, wantLogButton] = useToggleButton(t`Show log`, t`Hide log`, v => ({
        icon: History,
        sx: { rotate: v ? 0 : '180deg' },
    }), state.monitorWithLog)
    state.monitorWithLog = wantLog
    const logSize = logAble && wantLog ? 6 : 0
    return h(Fragment, {},
        h(Flex, {},
            h(Flex, { flex: 1 },
                h(SelectField as Field<boolean>, {
                    fullWidth: false,
                    value: monitorOnlyFiles,
                    onChange: v => state.monitorOnlyFiles = v,
                    options: { [t`Show downloads+uploads`]: true, [t`Show all connections`]: false }
                }),
            ),
            logAble && h(Flex, { flex: 1, justifyContent: 'space-between' },
                wantLog ? t`Live log` : h(Box),
                wantLogButton),
        ),
        h(Grid, { container: true, sx: { flex: 1 }, columnSpacing: 1 },
            h(Grid, { size: 12 - logSize, sx: fillFlexParentSx },
                h(DataTable, {
                    persist: 'connections',
                    error,
                    initializing,
                    rows,
                    getRowId: (row: any) => row.ip + ':' + row.port,
                    fillFlex: true,
                    noRows: monitorOnlyFiles && "No downloads/uploads at the moment",
                    actionsHeader: pauseButton,
                    footerSide: () => h(Flex, {},
                        h(Btn, {
                            size: 'small',
                            icon: DisconnectIcon,
                            labelIf: 'xl',
                            confirm: t`Disconnecting all connections but localhost. Continue?`,
                            onClick: () => apiCall('disconnect', { allButLocalhost: true }).then(x => toast(t("Disconnected: {result}", { result: x.result })))
                        }, t`Disconnect all`)
                    ),
                    columns: [
                        {
                            field: 'ip',
                            headerName: t`Address`,
                            flex: 1,
                            maxWidth: 400,
                            renderCell: ({ row, value }) => ipForUrl(value) + ' :' + row.port,
                            mergeRender: {
                                user: { sx: { display: 'flex', justifyContent: 'space-between', gap: '.5em' } },
                                agent: {},
                                country: {},
                            },
                        },
                        {
                            field: 'country',
                            headerName: t`Country`,
                            hideUnder: config.data?.[CFG.geo_enable] !== true || 'md',
                            renderCell: ({ value, row }) => h(Country, { code: value, ip: row.ip }),
                        },
                        {
                            field: 'user',
                            headerName: t`User`,
                            hideUnder: 'md',
                        },
                        {
                            field: 'started',
                            headerName: t`Started`,
                            type: 'dateTime',
                            width: 96,
                            hideUnder: 'lg',
                            valueFormatter: (value) => new Date(value as string).toLocaleTimeString(language)
                        },
                        {
                            field: 'path',
                            headerName: t`File`,
                            flex: 1.5,
                            renderCell({ value, row }) {
                                if (!value || !row.op) return
                                const rowContentSx = { display: 'flex', alignItems: 'center', height: '100%', minWidth: 0, gap: 1 } as const
                                if (row.op === 'browsing')
                                    return h(Box, { sx: rowContentSx }, h(Box, {}, value, h(Box, { sx: { fontSize: 'x-small' } }, t`browsing`)))
                                // keep icon and filename on the same row: datagrid v7 wraps cell content differently than before
                                return h(Box, { sx: rowContentSx },
                                    h(IconProgress, {
                                        icon: row.archive ? FolderZip : row.op === 'upload' ? Upload : Download,
                                        progress: row.opProgress ?? row.opOffset,
                                        offset: row.opOffset,
                                        title: md(formatPerc(row.opProgress) + (row.opTotal ? '\n' + t('total_size', { totalSize: formatBytes(row.opTotal) }) : '')),
                                    }),
                                    // clamp line-height locally so this cell doesn't inherit tall line metrics from datagrid wrappers
                                    h(Box, { sx: { lineHeight: '1.2em', minWidth: 0 } }, row.archive ? h(Box, {}, value, h(Box, {
                                            sx: { fontSize: 'x-small', color: 'text.secondary' }
                                        }, row.archive))
                                        : with_(value?.lastIndexOf('/'), i => h(Box, {}, value.slice(i + 1),
                                            i > 0 && h(Box, {
                                                sx: { fontSize: 'x-small', color: 'text.secondary' }
                                            }, value.slice(0, i))
                                        ))),
                                )
                            }
                        },
                        {
                            field: 'outSpeedKb',
                            headerName: t`Speed`,
                            width: 110,
                            hideUnder: 'sm',
                            type: 'number',
                            renderCell: ({ value, row }) => formatSpeedK(Math.max(value || 0, row.inSpeedKb || 0) || undefined),
                            mergeRender: { sent: { sx: { fontSize: 'small', textAlign: 'right' } } }
                        },
                        {
                            field: 'sent',
                            headerName: t`Sent`,
                            type: 'number',
                            hideUnder: 'md',
                            renderCell: ({ value, row }) => formatBytes(Math.max(value || 0, row.got || 0))
                        },
                        {
                            field: 'v',
                            headerName: t`Protocol`,
                            align: 'center',
                            hideUnder: Infinity,
                            renderCell: ({ value, row }) => h(Fragment, {},
                                t('ip_version', { version: value }),
                                row.secure && iconTooltip(Lock, t`HTTPS`, { opacity: .5 })
                            )
                        },
                        {
                            field: 'agent',
                            headerName: t`Agent`,
                            hideUnder: 'lg',
                            renderCell: ({ value }) => agentIcons(value)
                        },
                    ],
                    actionsProps: { hideUnder: 'sm' },
                    actions: ({ row }) => [
                        h(IconBtn, {
                            icon: DisconnectIcon,
                            title: t`Disconnect`,
                            doneMessage: true,
                            onClick: () => apiCall('disconnect', _.pick(row, ['ip', 'port'])).then(x => x.result > 0)
                        }),
                        h(BlockIpBtn, { ip: row.ip, comment: "From monitoring", disabled: row.ip === props?.you }),
                    ]
                }),
            ),
            logAble && wantLog && h(Grid, { size: logSize, sx: fillFlexParentSx },
                h(LogFile, {
                    file: `${CFG.log}|${CFG.error_log}`,
                    filter: monitorOnlyFiles ? (row => !row.uri.startsWith(SPECIAL_URI)) : undefined,
                    fillFlex: true,
                    compact: false,
                    limit: 1000,
                    getRowClassName: ({ row }) => row.status < 400 ? '' : 'isError',
                    sx: { '& .isError': { backgroundColor: '#a443' } },
                }) )
        )
    )
}

function formatSpeedK(value: number | undefined) {
    return value === undefined ? '' : formatSpeed(value * 1000, { digits: 1 })
}

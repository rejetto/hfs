// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { language, t } from './i18n'
import httpCodes from './httpCodes'
import { Box, Tab, Tabs } from '@mui/material'
import { PageProps } from './App'
import { API_URL, apiCall, useApi, useApiEx, useApiList } from './api'
import { DataTable, DataTableColumn, DataTableProps } from './DataTable'
import {
    CFG, formatBytes, HTTP_UNAUTHORIZED, newDialog, prefix, splitAt, tryJson, md, typedKeys, with_,
    _dbg, mapFilter, safeDecodeURIComponent, stringAfter, onlyTruthy, formatTimestamp, formatSpeed, copyTextToClipboard
} from '@hfs/shared'
import { agentIcons } from './agentIcons'
import {
    NetmaskField, Flex, IconBtn, useBreakpoint, usePauseButton, useToggleButton, Country,
    hTooltip, Btn, wikiLink
} from './mui'
import _ from 'lodash'
import {
    AutoDelete, LinkOff, AllInclusive, Delete, Download, Settings, SmartToy, Terminal, ContentCopy
} from '@mui/icons-material'
import { ConfigForm } from './ConfigForm'
import { BoolField, SelectField } from '@hfs/mui-grid-form'
import { toast, useDialogBarColors } from './dialog'
import { BlockIpBtn } from './blockIp'
import { ALL as COUNTRIES } from './countries'
import { useRoutedTab } from './routing'

const logLabels = {
    log: "Served",
    error_log: "Failed",
    console: "Console",
    disconnections: "Disconnections",
    ips: "IPs",
}
const LOG_FILES = typedKeys(logLabels)

let reloadIps: any

export default function LogsPage({ setTitleSide }: PageProps) {
    const files = LOG_FILES
    const [tab, setTab] = useRoutedTab('logs', files)
    const shorterLabels = !useBreakpoint('sm') && { error_log: t`Failed`, console: h(Terminal), disconnections: h(LinkOff) }
    const file = files[tab]
    const fileAvailable = file.endsWith('log')

    const logInfo = useApiEx('get_log_info')
    setTitleSide(useMemo(() => fileAvailable && (logInfo.element || with_(logInfo.data, data =>
        h(Box, { sx: { fontSize: 'smaller' } },
            t('current_log_size', { size: formatBytes(_.sum(Object.values(data.current))) }),
            h('br'),
            with_(Object.values(data.rotated).flat(), rotatedAsArray => t('archived_files', {
                n: rotatedAsArray.length,
                totalSize: formatBytes(_.sumBy(rotatedAsArray, 'size')),
            }))
        )
    )), [logInfo.element, logInfo.data, fileAvailable]))

    return h(Fragment, {},
        h(Flex, { gap: 0  },
            h(Tabs, { value: tab, onChange(_ev,i){ setTab(i) } },
                files.map(f => h(Tab, {
                    label: _.get(shorterLabels, f) || t(logLabels[f]),
                    key: f,
                    sx: { minWidth: 0, px: { xs: 1.5, sm: 2 } } // save space
                }))),
            h(Box, { sx: { flex: 1 } }),
            h(IconBtn, {
                icon: Download,
                title: fileAvailable ? t`Download as file` : t`Not available`,
                link: API_URL + `get_log_file?file=${file}`,
                disabled: !fileAvailable
            }),
            h(IconBtn, { icon: Settings, title: t`Options`, onClick: showLogOptions })
        ),
        files.map(f =>
            h(LogFile, { hidden: file !== f, file: f, key: f, fillFlex: true }) ),
    )

    function showLogOptions() {
        newDialog({
            title: t`Log options`,
            dialogProps: { sx: { maxWidth: '40em' } },
            Content() {
                return h(ConfigForm, {
                    barSx: { gap: 2, width: '100%', ...useDialogBarColors() },
                    form: {
                        stickyBar: true,
                        fields: [
                            { k: CFG.log, label: t(logLabels.log), sm: 6, helperText: t`Requests are logged here. Empty to disable it.` },
                            { k: CFG.error_log, label: t(logLabels.error_log), sm: 6, placeholder: t`errors go to main log`,
                                helperText: t`error_log_help`
                            },
                            { k: CFG.log_rotation, comp: SelectField, sm: 6, label: t`Log rotation`, options: [{ value:'', label:t`disabled` },
                                    ...['daily', 'weekly', 'monthly'].map(value => ({ value, label: t(value) })) ],
                                helperText: [wikiLink('Logs#rotation', t`To keep log-files smaller`), t` (deletion is not automatic)`],
                            },
                            { k: CFG.dont_log_net, comp: NetmaskField, label: t`Don't log address`, sm: 6, placeholder: t`no exception` },
                            { k: CFG.log_gui, sm: 6, comp: BoolField, label: t`Log interface loading`, helperText: t`Some requests are necessary to load the interface` },
                            { k: CFG.log_api, sm: 6, comp: BoolField, label: t`Log API requests`, helperText: t`Requests for commands` },
                            { k: CFG.log_ua, sm: 6, comp: BoolField, label: t`Log User-Agent`, helperText: t`user_agent_log_size_warning` },
                            { k: CFG.log_host, sm: 6, comp: BoolField, label: t`Log Host header` },
                            { k: CFG.log_spam, sm: 6, comp: BoolField, label: t`Log spam requests`, helperText: md(t`Failed requests that you probably don't want to see`) },
                            { k: CFG.log_spam_regex, label: t`Spam URL regex`,
                                helperText: t`log_spam_regex_help`,
                                getError(value: string) {
                                    try { new RegExp(value) }
                                    catch { return t`Invalid regular expression` }
                                },
                            },
                            { k: CFG.track_ips, sm: 6, comp: BoolField, label: t`Keep track of IPs`,
                                parentProps: { sx: { display: 'flex', gap: 1, alignItems: 'flex-start' } },
                                after: h(Btn, {
                                    size: 'small', variant: 'outlined', color: 'warning', sx: { mt: '4px' },
                                    confirm: true, doneMessage: true,
                                    onClick: () => apiCall('reset_ips').then(reloadIps)
                                }, t`Reset`)
                            },
                            { k: CFG.debug, sm: 6, comp: BoolField, label: t`Debug messages in console` },
                        ]
                    }
                })
            }
        })
    }
}

const LOGS_ON_FILE: string[] = [CFG.log, CFG.error_log]
const DEFAULT_MEMORY_LIMIT = 1_000_000

type LogFileProps = { filter?: (row:any) => boolean, limit?: number, hidden?: boolean, file: string, footerSide?: ReactNode } & Partial<DataTableProps>
export function LogFile({ file, footerSide, hidden, limit=DEFAULT_MEMORY_LIMIT, filter, ...rest }: LogFileProps) {
    const [showCountry, setShowCountry] = useState(false)
    const [showAgent, setShowAgent] = useState(false)
    const [showHost, setShowHost] = useState(false)
    const { pause, pauseButton } = usePauseButton()
    const [showApi, showApiButton] = useToggleButton(t`Show APIs`, t`Hide APIs`, v => ({
        icon: SmartToy,
        sx: { rotate: v ? 0 : '180deg' },
    }), true)
    const nextFileId = useRef(0)
    const [totalSize, setTotalSize] = useState(NaN)
    const [limited, setLimited] = useState(true)
    const [skipped, setSkipped] = useState(0)
    const [memoryLimit, setLimit] = useState(limit)
    limit = memoryLimit
    const MAX = 2**20 // 1MB
    const invert = true
    const [firstSight, setFirstSight] = useState(!hidden)
    useEffect(() => setFirstSight(x => x || !hidden), [hidden])
    const hasFile = LOGS_ON_FILE.includes(file)
    // clearing the remaining prefix after a full load must not request the tail again
    const { loading } = useApi(firstSight && hasFile && (limited || skipped > 0) && 'get_log_file', { file, range: limited || !skipped ? String(-MAX) : `0-${skipped}` }, {
        skipParse: true, skipLog: true,
        onResponse(res, body) {
            const lines = body.split('\n')
            if (limited) {
                const [range, total] = splitAt('/', res.headers.get('Content-Range') || '')
                const size = Number(total)
                if (isNaN(size)) throw _dbg("shouldn't happen")
                setTotalSize(size)
                if (range.startsWith('bytes 0-'))
                    setLimited(false)
                else {
                    lines.shift()
                    // the discarded fragment may start inside a UTF-8 character; only measure complete remaining lines
                    setSkipped(size - new Blob([lines.join('\n')]).size)
                }
            }
            else if (skipped) {
                toast(t('entire_log_loaded', { loadedSize: formatBytes(skipped) }))
                setSkipped(0)
            }
            // older file batches must not reuse the IDs of rows already displayed
            const treated = mapFilter(lines, (x: any) => enhanceLogLine(parseLogLine(x, nextFileId.current++)), Boolean, invert)
            setList(x => [...x, ...treated])
        }
    })
    // file-backed streams send only new events, so reconnecting must retain the loaded history
    const { list, setList, error, connecting, initializing, reload } = useApiList(firstSight && 'get_log', { file }, {
        limit, invert, pause, map: enhanceLogLine, keepListOnReconnect: hasFile
    })
    const isIps = file === 'ips'
    if (isIps)
        reloadIps = reload
    const tsColumn: DataTableColumn = {
        field: 'ts',
        headerName: t`Timestamp`,
        type: 'dateTime',
        width: 96,
        valueGetter: v => new Date(v),
        renderCell: ({ value }) => h(Fragment, {}, value.toLocaleDateString(language), h('br'), value.toLocaleTimeString(language)),
    }
    const ipColumn: DataTableColumn = {
        field: 'ip',
        headerName: t`Address`,
        flex: .6,
        minWidth: 130,
        maxWidth: 230,
        mergeRender: {
            user: { sx: { display: 'flex', justifyContent: 'space-between', gap: '.5em' } },
            country: showCountry && {},
            ua: {},
        },
    }
    const rows = useMemo(() =>
        filter ? list.filter(filter)
            : showApi || list?.[0]?.uri === undefined ? list
                : list.filter(x => !x.uri.startsWith(API_URL)),
        [list, showApi, filter])
    const isConsole = file === 'console'
    return hidden ? null : h(DataTable, {
        persist: 'log_' + file,
        error,
        loading: connecting,
        initializing: initializing || Boolean(loading),
        rows,
        compact: true,
        actionsProps: { hideUnder: 'md' },
        actions: isConsole ? undefined : (({ row }) => onlyTruthy([
            h(BlockIpBtn, { ip: row.ip, comment: "From log" }),
            isIps && h(Btn, {
                icon: Delete,
                confirm: true,
                title: t("Delete {ip}", { ip: row.ip }),
                doneMessage: true,
                onClick: () => apiCall('delete_ips', { ip: row.ip }).then(() => setList(was => was.filter(x => x.ip !== row.ip)))
            }),
            isIps && h(Btn, {
                icon: AutoDelete,
                confirm: true,
                title: t('delete_records_up_to', { timestamp: formatTimestamp(row.ts) }),
                onClick: () => apiCall('delete_ips', { ts: row.ts }).then(res => toast(t('items_deleted', { n: res.n }))).then(reload)
            }),
            hasFile && h(Btn, {
                icon: ContentCopy,
                title: t`Copy request`,
                doneAnimation: true,
                onClick: () => copyTextToClipboard(JSON.stringify(_.omit(row, 'id'), undefined, 2))
            })
        ])),
        initialState: isIps ? { sorting: { sortModel: [{ field: 'ts', sort: 'desc' }] } } : undefined,
        ...rest,
        footerSide: width => h(Box, {}, // 4 icons don't fit the tab row on mobile
            pauseButton,
            file.endsWith('log') && showApiButton,
            !connecting && skipped > 0 && h(Btn, {
                icon: AllInclusive,
                variant: 'outlined',
                sx: { ml: { sm: 1 } },
                labelIf: width > 700,
                title: t('partial_log_loaded', { loadedSize: formatBytes(MAX), totalSize: formatBytes(totalSize) }),
                loading: !limited,
                onClick() {
                    setLimit(0)
                    setLimited(false)
                }
            }, t`Load whole log`),
            footerSide,
        ),
        footerExtra: () => limit > 0 && list.length >= limit * .8 && h(Flex, { justifyContent: 'flex-end' },
            h(Btn, {
                size: 'small',
                variant: 'outlined',
                title: t('log_memory_limit_hint', { limit: limit.toLocaleString(language) },
                    'Currently keeping the latest {limit} rows in memory.'),
                onClick: () => setLimit(limit < DEFAULT_MEMORY_LIMIT ? DEFAULT_MEMORY_LIMIT : 0),
            }, limit < DEFAULT_MEMORY_LIMIT ? t`Show more` : t`Unlimited rows`),
        ),
        columns: isConsole ? [
            tsColumn,
            {
                field: 'k',
                headerName: t`Level`,
                hideUnder: 'sm',
            },
            {
                field: 'msg',
                headerName: t`Message`,
                flex: 1,
                mergeRender: { k: { override: { valueFormatter: (value) => value !== 'log' && value } } }
            }
        ] : isIps || file === 'disconnections' ? [
            tsColumn,
            ipColumn,
            isIps && {
                field: 'served',
                headerName: t`Requests`,
                width: 85,
                sx: { whiteSpace: 'pre-line' },
                valueGetter: (v, row) => v === undefined ? undefined : v + row.failed, // is this heavy with many records?
                renderCell: ({ row, value }) => value >= 0 && `✅ ${row.served}\n 🚫 ${row.failed}`,
            },
            {
                headerName: t`Country`,
                field: 'country',
                flex: 1,
                hideUnder: !showCountry || 'md',
                valueGetter: (value) => _.find(COUNTRIES, { code: value })?.name || value,
                renderCell: ({ row }) => h(Country, { code: row.country, long: true, def: '-' }),
            },
            !isIps && {
                field: 'msg',
                headerName: t`Message`,
                flex: 4,
            }
        ] : [
            ipColumn,
            {
                headerName: t`Country`,
                field: 'country',
                valueGetter: (_value, row) => row.extra?.country,
                hideUnder: !showCountry || 'xl',
                renderCell: ({ value }) => h(Country, { code: value, def: '-' }),
            },
            {
                field: 'user',
                headerName: t`Username`,
                flex: .3,
                maxWidth: 200,
                hideUnder: 'xl',
            },
            tsColumn,
            {
                field: 'method',
                headerName: t`Method`,
                width: 80,
                hideUnder: 'xl',
            },
            {
                field: 'status',
                headerName: t`Code`,
                type: 'number',
                width: 70,
                hideUnder: 'xl',
                renderCell: ({ value }) => hTooltip(prefix(value + ' - ', httpCodes[value]) || t`Unknown`, undefined,
                    h(Box, { sx: { bgcolor: '#888a', color: '#fff', borderRadius: '.3em', p: '.05em .3em', lineHeight: '1.2em' } }, value))
            },
            {
                field: 'length',
                headerName: t`Size`,
                type: 'number',
                hideUnder: 'md',
                valueFormatter: (value) => formatBytes(value as number)
            },
            {
                headerName: t`Agent`,
                field: 'ua',
                width: 60,
                hideUnder: !showAgent || 'md',
                valueGetter: (_value: any, row: any) => row.extra?.ua,
                renderCell: ({ value }) => agentIcons(value),
            },
            {
                field: 'host',
                headerName: t`Host`,
                width: 100,
                hideUnder: !showHost || 'md',
                valueGetter: (_value: any, row: any) => row.extra?.host,
            },
            {
                field: 'notes',
                headerName: t`Notes`,
                width: 110,
                hideUnder: 'sm',
                cellClassName: 'wrap',
                renderCell: ({ value }) => value && h(Box, { sx: { whiteSpace: 'pre-wrap' } }, value),
            },
            {
                field: 'uri',
                headerName: t`URI`,
                flex: 2,
                minWidth: 100,
                sx: { wordBreak: 'break-all' }, // be flexible, uri can be a mess
                mergeRender: { method: {}, status: {} },
                renderCell: ({ value, row }) => {
                    const [path, query] = splitAt('?', value).map(x => safeDecodeURIComponent(x))
                    const ul = row.extra?.ul
                    if (_.isArray(ul))
                        return path + ul.join(' + ')
                    if (!path.startsWith(API_URL))
                        return [path, query && h(Box as any, { key: 0, component: 'span', sx: { color: 'text.secondary', fontSize: 'smaller' } }, '?', query)]
                    const name = path.slice(API_URL.length)
                    const params = query && ': ' + Array.from(new URLSearchParams(query)).map(x => `${x[0]}=${tryJson(x[1]) ?? x[1]}`).join(' ; ')
                    return t("API {name}{params}", { name: name, params: params })
                }
            },
            {
                field: 'agentText',
                valueGetter: (_value: any, row: any) => row.extra?.ua,
                headerName: t`Agent text`,
                flex: 2,
                hideUnder: true,
            },
        ]
    })

    function enhanceLogLine(row: any) {
        if (!row) return
        const { extra } = row
        if ((extra?.country || row.country) && !showCountry)
            setShowCountry(true)
        if (extra?.ua && !showAgent)
            setShowAgent(true)
        if (extra?.host && !showHost)
            setShowHost(true)
        if (row.uri) {
            const upload = row.method === 'PUT' || extra?.ul
            const partial = upload && stringAfter('?', row.uri).includes('partial=')
            if (upload)
                row.length =  (extra?.size ?? 0)
                    + (!partial && Number(row.uri.match(/\?.*resume=(\d+)/)?.[1]) || 0) // show full size for full uploads
            const speed = extra?.speed && formatSpeed(extra.speed, { sep: ' ' })
            row.notes = extra?.dl ? t(speed ? 'log_full_download_at_speed' : 'log_full_download', { speed }) // 'dl' here is not the '?dl' of the url, and has a different meaning
                : upload ? t(partial
                    ? speed ? 'log_partial_upload_at_speed' : 'log_partial_upload'
                    : speed ? 'log_upload_at_speed' : 'log_upload', { speed })
                    : row.status === HTTP_UNAUTHORIZED && row.uri?.startsWith(API_URL + 'loginSrp')
                        ? t(extra?.u ? 'log_login_failed_for_user' : 'log_login_failed', { username: extra?.u })
                        : _.map(extra?.params, (v, k) => `${k}: ${v}\n`).join('') + (row.notes || '')
            if (extra?.aborted)
                row.notes += t` (aborted)`
        }
        return row
    }
}

function parseLogLine(line: string, id: number) {
    const m = /^(.+?) (.+?) (.+?) \[(.{11}):(.{14})] "(\w+) ([^"]+) HTTP\/\d.\d" (\d+) (-|\d+) ?(.*)/.exec(line)
    if (!m) return
    const [, ip, , user, date, time, method, uri, status, length, extra] = m
    return { // keep object format same as events emitted by the log module
        id,
        ip,
        user: user === '-' ? undefined : user,
        ts: new Date(date + ' ' + time),
        method,
        uri,
        status: Number(status),
        length: length === '-' ? undefined : Number(length),
        extra: tryJson(tryJson(extra)) || undefined,
    }
}

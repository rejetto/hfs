// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo, useState } from 'react';
import { Box, Tab, Tabs, Tooltip } from '@mui/material'
import { API_URL, useApiList } from './api'
import { DataTable } from './DataTable'
import { CFG, Dict, formatBytes, HTTP_UNAUTHORIZED, newDialog, prefix, shortenAgent, splitAt, tryJson, typedKeys, NBSP
} from '@hfs/shared'
import { logLabels } from './OptionsPage'
import { NetmaskField, Flex, IconBtn, useBreakpoint, usePauseButton, useToggleButton, WildcardsSupported, Country } from './mui';
import { GridColDef } from '@mui/x-data-grid'
import _ from 'lodash'
import { Settings, SmartToy } from '@mui/icons-material'
import md from './md'
import { ConfigForm } from './ConfigForm'
import { BoolField, SelectField } from '@hfs/mui-grid-form'
import { useDialogBarColors } from './dialog'

export default function LogsPage() {
    const [tab, setTab] = useState(0)
    const files = typedKeys(logLabels)
    const { pause, pauseButton } = usePauseButton()
    const [showApi, showApiButton] = useToggleButton(v => ({
        title: "Show/hide APIs",
        icon: SmartToy,
        sx: { rotate: v ? '0deg' : '180deg' },
        disabled: tab >= 2,
    }), true)
    const shorterLabels = !useBreakpoint('sm') && { error_log: "Errors" }
    return h(Fragment, {},
        h(Flex, { gap: 0  },
            h(Tabs, { value: tab, onChange(ev,i){ setTab(i) } },
                files.map(f => h(Tab, {
                    label: _.get(shorterLabels, f) || logLabels[f],
                    key: f,
                    sx: { minWidth: 0, px: { xs: 1.5, sm: 2 } } // save space
                }))),
            h(Box, { flex: 1 }),
            showApiButton,
            pauseButton,
            h(IconBtn, { icon: Settings, title: "Options", onClick: showLogOptions })
        ),
        h(LogFile, { key: tab, pause, showApi, file: files[tab] }), // without key, some state is accidentally preserved across files
    )

    function showLogOptions() {
        newDialog({
            title: "Log options",
            dialogProps: { sx: { maxWidth: '40em' } },
            Content() {
                return h(ConfigForm<{
                    [CFG.log]: string
                    [CFG.error_log]: string
                    [CFG.log_rotation]: string
                    [CFG.dont_log_net]: string
                    [CFG.log_gui]: boolean
                    [CFG.log_api]: boolean
                    [CFG.log_ua]: boolean
                }>, {
                    keys: [ CFG.log, CFG.error_log, CFG.log_rotation, CFG.dont_log_net, CFG.log_gui, CFG.log_api, CFG.log_ua ],
                    barSx: { gap: 2, width: '100%', ...useDialogBarColors() },
                    form: {
                        stickyBar: true,
                        fields: [
                            { k: CFG.log, label: logLabels.log, sm: 6, helperText: "Requests are logged here" },
                            { k: CFG.error_log, label: logLabels.error_log, sm: 6, placeholder: "errors go to main log",
                                helperText: "If you want errors in a different log"
                            },
                            { k: CFG.log_rotation, comp: SelectField, sm: 6, options: [{ value:'', label:"disabled" }, 'daily', 'weekly', 'monthly' ],
                                helperText: "To keep log-files smaller"
                            },
                            { k: CFG.dont_log_net, comp: NetmaskField, label: "Don't log address", sm: 6, placeholder: "no exception",
                                helperText: h(WildcardsSupported)
                            },
                            { k: CFG.log_gui, sm: 6, comp: BoolField, label: "Log interface loading", helperText: "Some requests are necessary to load the interface" },
                            { k: CFG.log_api, sm: 6, comp: BoolField, label: "Log API requests", helperText: "Requests for commands" },
                            { k: CFG.log_ua, sm: 6, comp: BoolField, label: "Log User-Agent", helperText: "Contains browser and possibly OS information" },
                        ]
                    }
                })
            }
        })
    }
}

function LogFile({ file, pause, showApi }: { file: string, pause?: boolean, showApi: boolean }) {
    const [showCountry, setShowCountry] = useState(false)
    const [showAgent, setShowAgent] = useState(false)
    const { list, error, connecting } = useApiList('get_log', { file }, {
        invert: true,
        pause,
        map(x) {
            const { extra } = x
            if (extra?.country && !showCountry)
                setShowCountry(true)
            if (extra?.ua && !showAgent)
                setShowAgent(true)
            x.notes = extra?.dl ? "fully downloaded"
                : (x.method === 'PUT' || extra?.ul) ? "uploaded " + formatBytes(extra.size, { sep: NBSP })
                : x.status === HTTP_UNAUTHORIZED && x.uri?.startsWith(API_URL + 'loginSrp') ? "login failed" + prefix(':\n', extra?.u)
                : x.notes
            return x
        }
    })
    const tsColumn: GridColDef = {
        field: 'ts',
        headerName: "Timestamp",
        type: 'dateTime',
        width: 90,
        valueGetter: ({ value }) => new Date(value as string),
        renderCell: ({ value }) => h(Fragment, {}, value.toLocaleDateString(), h('br'), value.toLocaleTimeString())
    }
    return h(DataTable, {
        error,
        loading: connecting,
        rows: useMemo(() => showApi || list?.[0]?.uri === undefined ? list : list.filter(x => !x.uri.startsWith(API_URL)), [list, showApi]), //TODO TypeError: l.uri is undefined
        compact: true,
        componentsProps: {
            pagination: {
                showFirstButton: true,
                showLastButton: true,
            }
        },
        columns: file === 'console' ? [
            tsColumn,
            {
                field: 'k',
                headerName: "Level",
                hideUnder: 'sm',
            },
            {
                field: 'msg',
                headerName: "Message",
                flex: 1,
                mergeRender: { other: 'k', override: { valueFormatter: ({ value }) => value !== 'log' && value } }
            }
        ] : [
            {
                field: 'ip',
                headerName: "Address",
                flex: .6,
                minWidth: 100,
                maxWidth: 230,
                mergeRender: {
                    other: 'user',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '.5em',
                    override: { renderCell: ({ value, row }) => h(Fragment, {}, h('span', {}, value), h(Country, { code: row.extra?.country })) }
                },
            },
            {
                headerName: "Country",
                field: 'country',
                valueGetter: ({ row }) => row.extra?.country,
                hidden: !showCountry,
                hideUnder: 'xl',
                renderCell: ({ value }) => h(Country, { code: value, def: '-' }),
            },
            {
                field: 'user',
                headerName: "Username",
                flex: .3,
                maxWidth: 200,
                hideUnder: 'xl',
            },
            tsColumn,
            {
                field: 'method',
                headerName: "Method",
                width: 80,
                hideUnder: 'xl',
            },
            {
                field: 'status',
                headerName: "Code",
                type: 'number',
                width: 70,
                hideUnder: 'xl',
            },
            {
                field: 'length',
                headerName: "Size",
                type: 'number',
                hideUnder: 'md',
                valueFormatter: ({ value }) => formatBytes(value as number)
            },
            {
                headerName: "Agent",
                hideUnder: 'md',
                field: 'ua',
                width: 60,
                hidden: !showAgent,
                valueGetter: ({ row }) => row.extra?.ua,
                renderCell: ({ value }) =>
                    value && agentIcons(value),
            },
            {
                field: 'notes',
                headerName: "Notes",
                width: 105, // https://github.com/rejetto/hfs/discussions/388
                hideUnder: 'sm',
                cellClassName: 'wrap',
                renderCell: ({ value }) => value && md(value),
            },
            {
                field: 'uri',
                headerName: "URI",
                flex: 2,
                minWidth: 100,
                mergeRender: { other: 'method', fontSize: 'small' },
                renderCell: ({ value, row }) => {
                    const [path, query] = splitAt('?', value).map(decodeURIComponent)
                    const ul = row.extra?.ul
                    if (ul)
                        return typeof ul === 'string' ? ul // legacy pre-0.51
                            : path + ul.join(' + ')
                    if (!path.startsWith(API_URL))
                        return [path, query && h(Box, { key: 0, component: 'span', color: 'text.secondary', fontSize: 'smaller' }, '?', query)]
                    const name = path.slice(API_URL.length)
                    const params = query && ': ' + Array.from(new URLSearchParams(query)).map(x => `${x[0]}=${tryJson(x[1]) ?? x[1]}`).join(' ; ')
                    return "API " + name + params
                }
            },
        ]
    })
}

export function agentIcons(agent: string) {
    const UW = 'https://upload.wikimedia.org/wikipedia/commons/'
    const short = shortenAgent(agent)
    const browserIcon = icon(short, {
        Chrome: UW + 'e/e1/Google_Chrome_icon_%28February_2022%29.svg',
        Chromium: UW + 'f/fe/Chromium_Material_Icon.svg',
        Firefox: UW + 'a/a0/Firefox_logo%2C_2019.svg',
        Safari: UW + '5/52/Safari_browser_logo.svg',
        Edge: UW + 'f/f6/Edge_Logo_2019.svg',
        Opera: UW + '4/49/Opera_2015_icon.svg',
    })
    const os = _.findKey(OSS, re => re.test(agent))
    const osIcon = os && icon(os, {
        android: UW + 'd/d7/Android_robot.svg',
        linux: UW + '0/0a/Tux-shaded.svg',
        win: UW + '0/0a/Unofficial_Windows_logo_variant_-_2002%E2%80%932012_%28Multicolored%29.svg',
        apple: UW + '7/74/Apple_logo_dark_grey.svg', // grey works for both themes
    })
    return h(Tooltip, { title: agent, children: h('span', { fontSize: '18px' }, browserIcon || short, ' ', osIcon) })

    function icon(k: string, map: Dict<string>) {
        const src = map[k]
        return src && h('img', { src, style: { height: '1em', verticalAlign: 'bottom', marginRight: '.2em' } })
    }
}

const OSS = {
    apple: /Mac OS|iPhone OS/,
    win: /Windows NT/,
    android: /Android/,
    linux: /Linux/,
}

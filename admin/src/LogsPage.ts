// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo, useState } from 'react';
import { Box, Tab, Tabs } from '@mui/material'
import { API_URL, useApiList } from './api'
import { DataTable } from './DataTable'
import { formatBytes, tryJson } from '@hfs/shared'
import { logLabels } from './OptionsPage'
import { Flex, typedKeys, useBreakpoint, usePauseButton, useToggleButton } from './misc';
import { GridColDef } from '@mui/x-data-grid'
import _ from 'lodash'
import { SmartToy } from '@mui/icons-material'

export default function LogsPage() {
    const [tab, setTab] = useState(0)
    const files = typedKeys(logLabels)
    const { pause, pauseButton } = usePauseButton()
    const [showApi, showApiButton] = useToggleButton(v => ({
        title: v ? "hide APIs" : "show APIs",
        icon: SmartToy,
        sx: { rotate: v ? '0deg' : '180deg' },
        disabled: tab >= 2,
    }), true)
    const shorterLabels = !useBreakpoint('sm') && { error_log: "Errors" }
    return h(Fragment, {},
        h(Flex, { gap: 0  },
            h(Tabs, { value: tab, onChange(ev,i){ setTab(i) } },
                files.map(f => h(Tab, { label: _.get(shorterLabels, f) || logLabels[f], key: f })) ),
            h(Box, { flex: 1 }),
            showApiButton,
            pauseButton,
        ),
        h(LogFile, { key: tab, pause, showApi, file: files[tab] }), // without key, some state is accidentally preserved across files
    )
}

function LogFile({ file, pause, showApi }: { file: string, pause?: boolean, showApi: boolean }) {
    const { list, error, connecting } = useApiList('get_log', { file }, {
        invert: true,
        pause,
        map(x) {
            const { extra } = x
            if (!extra) return
            const notes = extra.dl ? "fully downloaded" : extra.ul ? "uploaded " + formatBytes(extra.size) : ''
            if (notes)
                x.notes = notes
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
        rows: useMemo(() => showApi ? list : list.filter(x => !x.uri.startsWith(API_URL)), [list, showApi]),
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
                mergeRender: { other: 'user' },
            },
            {
                field: 'user',
                headerName: "Username",
                flex: .3,
                maxWidth: 200,
                hideUnder: 'lg',
            },
            tsColumn,
            {
                field: 'method',
                headerName: "Method",
                width: 80,
                hideUnder: 'lg',
            },
            {
                field: 'status',
                headerName: "Code",
                type: 'number',
                width: 70,
                hideUnder: 'lg',
            },
            {
                field: 'length',
                headerName: "Size",
                type: 'number',
                hideUnder: 'md',
                valueFormatter: ({ value }) => formatBytes(value as number)
            },
            {
                field: 'notes',
                headerName: "Notes",
                width: 105, // https://github.com/rejetto/hfs/discussions/388
                hideUnder: 'sm',
                cellClassName: 'wrap',
            },
            {
                field: 'uri',
                headerName: "URI",
                flex: 2,
                minWidth: 100,
                mergeRender: { other: 'method', fontSize: 'small' },
                renderCell: ({ value, row }) => {
                    if (row.extra?.ul)
                        return row.extra?.ul
                    value = decodeURIComponent(value)
                    if (!value.startsWith(API_URL))
                        return value
                    const ofs = API_URL.length
                    const i = value.indexOf('?', ofs)
                    const name = value.slice(ofs, i > 0 ? i : Infinity)
                    const params = i < 0 ? ''
                        : Array.from(new URLSearchParams(value.slice(i))).map(x => `${x[0]}=${tryJson(x[1]) ?? x[1]}`).join(' ; ')
                    return `API ${name} ${params}`
                }
            },
        ]
    })
}

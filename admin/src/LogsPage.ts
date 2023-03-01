// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useState } from 'react';
import { Tab, Tabs } from '@mui/material'
import { useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { formatBytes } from '@hfs/shared'
import { logLabels } from './OptionsPage'
import { typedKeys } from './misc';

export default function LogsPage() {
    const [tab, setTab] = useState(0)
    const files = typedKeys(logLabels)
    return h(Fragment, {},
        h(Tabs, { value: tab, onChange(ev,i){ setTab(i) } },
            files.map(f => h(Tab, { label: logLabels[f], key: f })) ),
        h(LogFile, { key: tab, file: files[tab] }), // without key, some state is accidentally preserved across files
    )
}

function LogFile({ file }: { file: string }) {
    const { list, error, connecting } = useApiList('get_log', { file }, { addId: true })
    if (error)
        return error
    return h(DataGrid, {
        loading: connecting,
        rows: list as any,
        componentsProps: {
            pagination: {
                showFirstButton: true,
                showLastButton: true,
            }
        },
        columns: [
            {
                field: 'ip',
                headerName: "Address",
                flex: .6,
                minWidth: 100,
                maxWidth: 230,
            },
            {
                field: 'user',
                headerName: "Username",
                flex: .4,
                maxWidth: 200,
            },
            {
                field: 'ts',
                headerName: "Timestamp",
                type: 'dateTime',
                width: 170,
                valueFormatter: ({ value }) => new Date(value as string).toLocaleString()
            },
            {
                field: 'method',
                headerName: "Method",
                width: 80,
            },
            {
                field: 'status',
                headerName: "Code",
                type: 'number',
                width: 70,
            },
            {
                field: 'length',
                headerName: "Size",
                type: 'number',
                valueFormatter: ({ value }) => formatBytes(value as number)
            },
            {
                field: 'uri',
                headerName: "URI",
                flex: 2,
                minWidth: 100,
            },
        ]
    })
}

import { createElement as h, Fragment, useState } from 'react';
import { Tab, Tabs } from '@mui/material'
import { useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { formatBytes } from '@hfs/shared'
import { logLabels } from './ConfigPage'
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
    const { list, error } = useApiList('get_log', { file }, { addId: true })
    if (error)
        return error
    return h(DataGrid, {
        loading: !list,
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
                flex: 1,
                minWidth: 100,
                maxWidth: 400,
            },
            {
                field: 'user',
                headerName: "Username",
                flex: 1,
            },
            {
                field: 'ts',
                headerName: "Timestamp",
                type: 'dateTime',
                width: 200,
                valueFormatter: ({ value }) => new Date(value as string).toLocaleString()
            },
            {
                field: 'method',
                headerName: "Method",
            },
            {
                field: 'status',
                headerName: "Code",
                type: 'number',
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

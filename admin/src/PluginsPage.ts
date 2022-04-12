import { createElement as h } from "react"
import { apiCall, useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { Alert } from '@mui/material'
import { IconBtn } from './misc'
import { PowerSettingsNew } from '@mui/icons-material'

export default function PluginsPage() {
    const { list, error, initializing } = useApiList('get_plugins')
    if (error)
        return h(Alert, { severity: 'error' }, error)
    return h(DataGrid, {
        rows: list,
        loading: initializing,
        disableColumnSelector: true,
        disableColumnMenu: true,
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
            },
            {
                field: 'started',
                width: 180,
                valueFormatter: ({ value }) => !value ? "off" : new Date(value as string).toLocaleString()
            },
            {
                field: 'version',
                width: 80,
            },
            {
                field: 'description',
                flex: 1,
            },
            {
                field: "Actions ",
                width: 80,
                align: 'center',
                renderCell({ row }) {
                    return h('div', {},
                        h(IconBtn, {
                            icon: PowerSettingsNew,
                            title: (row.started ? "Stop" : "Start") + ' ' + row.id,
                            onClick: () => apiCall('set_plugin', { id: row.id, disable: !!row.started }),
                        })
                    )
                }
            },
        ]
    })
}

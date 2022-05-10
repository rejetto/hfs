import { apiCall, useApiList } from './api'
import { Fragment, createElement as h, useState } from 'react'
import { Alert } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { IconBtn, spinner } from './misc'
import { Download, Search } from '@mui/icons-material'
import { confirmDialog, toast } from './dialog'
import { StringField } from './Form'
import { useDebounce } from 'use-debounce'

export default function OnlinePlugins() {
    const [search, setSearch] = useState('')
    const [debouncedSearch] = useDebounce(search, 1000)
    const { list, error, initializing } = useApiList('search_online_plugins', { text: debouncedSearch })
    if (error)
        return h(Alert, { severity: 'error' }, error)
    return h(Fragment, {},
        h(StringField, {
            value: search,
            onChange: setSearch as any,
            start: h(Search),
            typing: true,
            label: "Search text"
        }),
        h(DataGrid, {
            rows: list,
            loading: initializing,
            columns: [
                {
                    field: 'id',
                    headerName: "name",
                    flex: .3,
                    minWidth: 150,
                },
                {
                    field: 'version',
                    width: 70,
                },
                {
                    field: 'description',
                    flex: 1,
                },
                {
                    field: "actions",
                    width: 80,
                    align: 'center',
                    hideSortIcons: true,
                    disableColumnMenu: true,
                    renderCell({ row }) {
                        return row.downloading ? spinner() : h(IconBtn, {
                            icon: Download,
                            title: "Download",
                            disabled: row.installed && "Already installed",
                            async onClick() {
                                if (!await confirmDialog("WARNING - Proceed only if you trust this author and this plugin")) return
                                const { id } = row
                                return apiCall('download_plugin', { id })
                                    .then(() => toast("Plugin downloaded: " + id))
                            }
                        })
                    }
                },
            ]
        })
    )
}


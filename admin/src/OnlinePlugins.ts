// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { Fragment, createElement as h, useState } from 'react'
import { DataTable } from './DataTable'
import { IconBtn } from './misc'
import { Download, Search } from '@mui/icons-material'
import { StringField } from '@hfs/mui-grid-form'
import { useDebounce } from 'usehooks-ts'
import { renderName, startPlugin } from './InstalledPlugins'
import { state, useSnapState } from './state'
import { alertDialog, confirmDialog } from './dialog'

export default function OnlinePlugins() {
    const [search, setSearch] = useState('')
    const debouncedSearch = useDebounce(search, 1000)
    const { list, error, initializing } = useApiList('get_online_plugins', { text: debouncedSearch })
    const snap = useSnapState()
    return h(Fragment, {},
        h(StringField, {
            value: search,
            onChange: setSearch as any,
            start: h(Search),
            typing: true,
            label: "Search text"
        }),
        h(DataTable, {
            error,
            rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
            noRows: "No compatible plugins have been found",
            initializing,
            columnVisibilityModel: snap.onlinePluginsColumns,
            onColumnVisibilityModelChange: newModel => Object.assign(state.onlinePluginsColumns, newModel),
            columns: [
                {
                    field: 'id',
                    headerName: "name",
                    flex: 1,
                    renderCell: renderName,
                    mergeRender: { other: 'description', fontSize: 'x-small' },
                },
                {
                    field: 'version',
                    width: 70,
                },
                {
                    field: 'pushed_at',
                    headerName: "last update",
                    valueGetter: ({ value }) => new Date(value).toLocaleDateString(),
                },
                {
                    field: 'license',
                    width: 80,
                },
                {
                    field: 'description',
                    flex: 3,
                    hideUnder: 'sm',
                },
                {
                    field: 'stargazers_count',
                    width: 50,
                    headerName: "stars",
                    align: 'center',
                    hideUnder: 'sm',
                },
            ],
            actions: ({ row, id }) => [
                h(IconBtn, {
                    icon: Download,
                    title: "Install",
                    progress: row.downloading,
                    disabled: row.installed && "Already installed",
                    tooltipProps: { placement:'bottom-end' }, // workaround problem with horizontal scrolling by moving the tooltip leftward
                    confirm: "WARNING - Proceed only if you trust this author and this plugin",
                    async onClick() {
                        const branch = row.branch || row.default_branch
                        try {
                            const res = await apiCall('download_plugin', { id, branch }, { timeout: false })
                            if (await confirmDialog(`Plugin ${id} downloaded`, { confirmText: "Start" }))
                                await startPlugin(res.id)
                        }
                        catch(e: any) {
                            if (e.code !== 424) throw e
                            const msg = h(Fragment, {}, "This plugin has some dependencies unmet:",
                                e.data.map((x: any) => h('li', { key: x.repo }, x.repo + ': ' + x.error)) )
                            return alertDialog(msg, 'error')
                        }
                    }
                })
            ]
        })
    )
}


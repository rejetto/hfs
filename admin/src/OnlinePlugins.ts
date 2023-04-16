// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { Fragment, createElement as h, useState } from 'react'
import { DataGrid } from '@mui/x-data-grid'
import { IconBtn } from './misc'
import { Download, Search } from '@mui/icons-material'
import { StringField } from '@hfs/mui-grid-form'
import { useDebounce } from 'usehooks-ts'
import { renderName, showError, startPlugin, UpdateButton } from './InstalledPlugins'
import { state, useSnapState } from './state'
import _ from 'lodash'

export default function OnlinePlugins() {
    const [search, setSearch] = useState('')
    const debouncedSearch = useDebounce(search, 1000)
    const { list, error, initializing, updateList } = useApiList('search_online_plugins', { text: debouncedSearch })
    const snap = useSnapState()
    if (error)
        return showError(error)
    return h(Fragment, {},
        h(StringField, {
            value: search,
            onChange: setSearch as any,
            start: h(Search),
            typing: true,
            label: "Search text"
        }),
        h(DataGrid, {
            rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
            localeText: { noRowsLabel: "No compatible plugins have been found" },
            loading: initializing,
            columnVisibilityModel: snap.onlinePluginsColumns,
            onColumnVisibilityModelChange: newModel => Object.assign(state.onlinePluginsColumns, newModel),
            columns: [
                {
                    field: 'id',
                    headerName: "name",
                    flex: 1,
                    renderCell: renderName,
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
                },
                {
                    field: 'stargazers_count',
                    width: 50,
                    headerName: "stars",
                    align: 'center',
                },
                {
                    field: "actions",
                    width: 80,
                    align: 'center',
                    hideSortIcons: true,
                    disableColumnMenu: true,
                    hideable: false,
                    renderCell({ row }) {
                        const { id, branch } = row
                        return h('div', {},
                            row.update ? h(UpdateButton, {
                                id,
                                then() {
                                    updateList(list =>
                                        _.find(list, { id }).update = false )
                                }
                            }) : h(IconBtn, {
                                icon: Download,
                                title: "Install",
                                progress: row.downloading,
                                disabled: row.installed && "Already installed",
                                tooltipProps: { placement:'bottom-end' }, // workaround problem with horizontal scrolling by moving the tooltip leftward
                                confirm: "WARNING - Proceed only if you trust this author and this plugin",
                                async onClick() {
                                    const res = await apiCall('download_plugin', { id, branch })
                                    await startPlugin(res.id)
                                }
                            })
                        )
                    }
                },
            ]
        })
    )
}


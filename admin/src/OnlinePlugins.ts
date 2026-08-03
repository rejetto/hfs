// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useApiList } from './api'
import { Fragment, createElement as h, useState } from 'react'
import { DataTable } from './DataTable'
import { err2msg, newDialog, wantArray, xlate } from './misc'
import { ArrowBack, ArrowForward, Download, RemoveRedEye, Search } from '@mui/icons-material'
import { StringField } from '@hfs/mui-grid-form'
import { useDebounce } from 'usehooks-ts'
import { descriptionField, themeField } from './InstalledPlugins'
import { state, useSnapState } from './state'
import { Flex, IconBtn } from './mui'
import { installPluginFromResult, PLUGIN_ERRORS, renderPluginName } from './plugin'

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
            error: error && err2msg(xlate(error, PLUGIN_ERRORS)),
            rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
            noRows: "No compatible plugins have been found",
            fillFlex: true,
            initializing,
            columnVisibilityModel: snap.onlinePluginsColumns,
            onColumnVisibilityModelChange: newModel => Object.assign(state.onlinePluginsColumns, newModel),
            columns: [
                {
                    field: 'id',
                    headerName: "name",
                    flex: 1,
                    renderCell: renderPluginName,
                    mergeRender: { description: { sx: { fontSize: 'x-small' } } },
                },
                {
                    field: 'version',
                    width: 70,
                },
                {
                    field: 'pushed_at',
                    headerName: "last update",
                    valueGetter: (value) => new Date(value).toLocaleDateString(),
                },
                {
                    field: 'license',
                    width: 80,
                },
                themeField,
                {
                    ...descriptionField,
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
                    onClick: () => installPluginFromResult(row)
                }),
                h(IconBtn, {
                    icon: RemoveRedEye,
                    disabled: !row.preview,
                    onClick: () => newDialog({
                        title: id,
                        Content: () => h(ShowImages, { imgs: wantArray(row.preview) })
                    })
                }),
            ]
        })
    )
}

function ShowImages({ imgs }: { imgs: string[] }) {
    const [cur, setCur] = useState(0)
    return h(Flex, { vert: true, flex: 1 },
        h(Flex, { vert: true, center: true, height: 0, flex: 'auto', minHeight: '50vh', minWidth: '50vw'  },
            h('img', { src: imgs[cur], style: { margin: 'auto', /*center*/ maxWidth: '100%', maxHeight: '100%' /*limit*/ } }),
        ),
        imgs.length > 1 && h(Flex, { center: true },
            h(IconBtn, { icon: ArrowBack,    disabled: !cur, onClick: () => setCur(cur - 1) }),
            h(IconBtn, { icon: ArrowForward, disabled: cur >= imgs.length - 1, onClick: () => setCur(cur + 1) }),
        ),
    )
}

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { Fragment, createElement as h, useState } from 'react'
import { DataTable } from './DataTable'
import { HTTP_FAILED_DEPENDENCY, newDialog, wantArray, xlate } from './misc'
import { ArrowBack, ArrowForward, Download, RemoveRedEye, Search, Warning } from '@mui/icons-material'
import { StringField } from '@hfs/mui-grid-form'
import { useDebounce } from 'usehooks-ts'
import { descriptionField, renderName, startPlugin, themeField } from './InstalledPlugins'
import { state, useSnapState } from './state'
import { alertDialog, confirmDialog, toast } from './dialog'
import _ from 'lodash'
import { PLUGIN_ERRORS } from './PluginsPage'
import { Flex, IconBtn } from './mui'

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
            error: xlate(error, PLUGIN_ERRORS),
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
                    renderCell: renderName,
                    mergeRender: { description: { fontSize: 'x-small' } },
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
                    confirm: h(Flex, { vert: true, alignItems: 'center' },
                        h(Warning, { color: 'warning', fontSize: 'large' }),
                        "Proceed only if you trust this plugin",
                    ),
                    async onClick() {
                        if (row.missing && !await confirmDialog("This will also install: " + _.map(row.missing, 'repo').join(', '))) return
                        const branch = row.branch || row.default_branch
                        installPlugin(id, branch).catch((e: any) => {
                            if (e.code !== HTTP_FAILED_DEPENDENCY)
                                return alertDialog(e)
                            const msg = h(Fragment, {}, "This plugin has some dependencies unmet:",
                                e.data.map((x: any) => h('li', { key: x.repo }, x.repo + ': ' + x.error)) )
                            return alertDialog(msg, 'error')
                        })
                    }
                }),
                h(IconBtn, {
                    icon: RemoveRedEye,
                    disabled: !row.preview,
                    onClick: () => newDialog({
                        title: id,
                        dialogProps: { sx: { minHeight: '50vh', minWidth: '50vw' } }, // the image will use available space, so we must reserve it (while mobile is going full-screen)
                        Content: () => h(ShowImages, { imgs: wantArray(row.preview) })
                    })
                }),
            ]
        })
    )

    async function installPlugin(id: string, branch?: string): Promise<any> {
        try {
            const res = await apiCall('download_plugin', { id, branch, stop: true }, { timeout: false })
            if (await confirmDialog(`Plugin ${id} downloaded`, { trueText: "Start" }))
                await startPlugin(res.id)
        }
        catch(e:any) {
            let done = false
            if (e.code === HTTP_FAILED_DEPENDENCY) // try to install automatically
                for (const x of e.cause)
                    if (x.error === 'missing') {
                        toast("Installing dependency: " + x.repo)
                        await installPlugin(x.repo)
                        done = true
                    }
            if (done) // try again
                return installPlugin(id, branch)
            throw e
        }
    }
}

function ShowImages({ imgs }: { imgs: string[] }) {
    const [cur, setCur] = useState(0)
    return h(Flex, { vert: true, flex: 1 },
        h(Flex, { vert: true, center: true, height: 0, flex: 'auto' },
            h('img', { src: imgs[cur], style: { margin: 'auto', /*center*/ maxWidth: '100%', maxHeight: '100%' /*limit*/ } }),
        ),
        imgs.length > 1 && h(Flex, { center: true },
            h(IconBtn, { icon: ArrowBack,    disabled: !cur, onClick: () => setCur(cur - 1) }),
            h(IconBtn, { icon: ArrowForward, disabled: cur >= imgs.length - 1, onClick: () => setCur(cur + 1) }),
        ),
    )
}
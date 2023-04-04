// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { createElement as h, Fragment } from 'react'
import { Alert, Box, Tooltip } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { Delete, Error, GitHub, PlayCircle, Settings, StopCircle, Upgrade } from '@mui/icons-material'
import { IconBtn, xlate } from './misc'
import { formDialog, toast } from './dialog'
import _ from 'lodash'
import { BoolField, Field, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import FileField from './FileField'

export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, setList, error, initializing } = useApiList(updates ? 'get_plugin_updates' : 'get_plugins')
    if (error)
        return showError(error)
    return h(DataGrid, {
        rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
        loading: initializing,
        disableColumnSelector: true,
        disableColumnMenu: true,
        columnVisibilityModel: {
            started: !updates,
        },
        localeText: updates && { noRowsLabel: `No updates available. Only plugins available on "search online" are checked.` },
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
                minWidth: 150,
                renderCell({ row, value }) {
                    return h(Fragment, {},
                        value,
                        typeof row.badApi === 'string' && h(Tooltip, { title: row.badApi, children: h(Error, { color: 'warning', sx: { ml: 1 } }) }),
                        repoLink(row.repo),
                    )
                }
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
                width: 120,
                align: 'center',
                headerAlign: 'center',
                hideSortIcons: true,
                disableColumnMenu: true,
                renderCell({ row }) {
                    const { config, id } = row
                    if (updates)
                        return h(UpdateButton, { id, then: () => setList(list.filter(x => x.id !== id)) })
                    return h('div', {},
                        h(IconBtn, row.started ? {
                            icon: StopCircle,
                            title: h(Box, {}, `Stop ${id}`, h('br'), `Started ` + new Date(row.started as string).toLocaleString()),
                            color: 'success',
                            onClick: () =>
                                apiCall('set_plugin', { id, enabled: false }).then(() =>
                                    toast("Plugin is stopping", h(StopCircle, { color: 'warning' })))
                        } : {
                            icon: PlayCircle,
                            title: `Start ${id}`,
                            onClick: () => startPlugin(id),
                        }),
                        h(IconBtn, {
                            icon: Settings,
                            title: "Options",
                            disabled: !row.started && "Start plugin to access options"
                                || !config && "No options available for this plugin",
                            progress: false,
                            async onClick() {
                                const pl = await apiCall('get_plugin', { id })
                                const values = await formDialog({
                                    title: `${id} options`,
                                    form: {
                                        before: h(Box, { mx: 2, mb: 3 }, row.description),
                                        fields: makeFields(config),
                                    },
                                    values: pl.config,
                                    dialogProps: row.configDialog,
                                })
                                if (!values || _.isEqual(pl.config, values)) return
                                await apiCall('set_plugin', { id, config: values })
                                toast("Configuration saved")
                            }
                        }),
                        h(IconBtn, {
                            icon: Delete,
                            title: "Uninstall",
                            confirm: "Remove?",
                            async onClick() {
                                await apiCall('uninstall_plugin', { id })
                                toast("Plugin uninstalled")
                            }
                        }),
                    )
                }
            },
        ]
    })
}

function makeFields(config: any) {
    return Object.entries(config).map(([k,o]: [string,any]) => {
        if (!_.isPlainObject(o))
            return o
        let { type, defaultValue, fields, frontend, ...rest } = o
        const comp = (type2comp as any)[type] as Field<any> | undefined
        if (comp === ArrayField)
            fields = makeFields(fields)
        if (defaultValue !== undefined && type === 'boolean')
            rest.placeholder = `Default value is ${JSON.stringify(defaultValue)}`
        return { k, comp, fields, ...rest }
    })
}

const type2comp = {
    string: StringField,
    number: NumberField,
    boolean: BoolField,
    select: SelectField,
    multiselect: MultiSelectField,
    array: ArrayField,
    real_path: FileField,
}

export function repoLink(repo?: string) {
    return repo && h(IconBtn, {
        icon: GitHub,
        title: "Open web page",
        link: 'https://github.com/' + repo,
    })
}

export function showError(error: any) {
    return h(Alert, { severity: 'error' }, xlate(error, {
        ENOTFOUND: "Couldn't reach github.com"
    }))
}

export function UpdateButton({ id, then }: { id: string, then: (id:string)=>void }) {
    return h(IconBtn, {
        icon: Upgrade,
        title: "Update",
        async onClick() {
            await apiCall('update_plugin', { id })
            then?.(id)
            toast("Plugin updated")
        }
    })
}

export function startPlugin(id: string) {
    return apiCall('set_plugin', { id, enabled: true }).then(() =>
        toast("Plugin is starting", h(PlayCircle, { color: 'success' })))
}

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiList } from './api'
import { createElement as h, Fragment, ReactNode } from 'react'
import { Alert, Box, Link, Tooltip } from '@mui/material'
import { DataTable } from './DataTable'
import { Delete, Error, PlayCircle, Settings, StopCircle, Upgrade } from '@mui/icons-material'
import { IconBtn, with_, xlate } from './misc'
import { formDialog, toast } from './dialog'
import _ from 'lodash'
import { BoolField, Field, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import FileField from './FileField'

export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, updateEntry, error, initializing } = useApiList(updates ? 'get_plugin_updates' : 'get_plugins')
    if (error)
        return showError(error)
    return h(DataTable, {
        rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
        initializing,
        disableColumnSelector: true,
        disableColumnMenu: true,
        hideFooter: true,
        noRows: updates && `No updates available. Only plugins available on "search online" are checked.`,
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
                minWidth: 150,
                renderCell: renderName,
                mergeRender: { other: 'description', fontSize: 'x-small' }
            },
            {
                field: 'version',
                width: 70,
                hideUnder: 'sm',
            },
            {
                field: 'description',
                flex: 1,
                hideUnder: 'sm',
            },
        ],
        actions: ({ row, id }) => updates ? [
            h(UpdateButton, { id, updated: row.updated, then: () => updateEntry({ id }, { updated: true }) })
        ] : [
            h(IconBtn, row.started ? {
                icon: StopCircle,
                title: h(Box, {}, `Stop ${id}`, h('br'), `Started ` + new Date(row.started as string).toLocaleString()),
                size: 'small',
                color: 'success',
                async onClick() {
                    await apiCall('stop_plugin', { id })
                    toast("Plugin stopped", h(StopCircle, { color: 'warning' }))
                }
            } : {
                icon: PlayCircle,
                title: `Start ${id}`,
                size: 'small',
                onClick: () => startPlugin(id),
            }),
            h(IconBtn, {
                icon: Settings,
                title: "Options",
                size: 'small',
                disabled: !row.started && "Start plugin to access options"
                    || !row.config && "No options available for this plugin",
                progress: false,
                async onClick() {
                    const pl = await apiCall('get_plugin', { id })
                    const values = await formDialog({
                        title: `${id} options`,
                        form: {
                            before: h(Box, { mx: 2, mb: 3 }, row.description),
                            fields: makeFields(row.config),
                        },
                        values: pl.config,
                        dialogProps: _.merge({ sx: { m: 'auto' } }, // center content when it is smaller than mobile (because of full-screen)
                            row.configDialog),
                    })
                    if (!values || _.isEqual(pl.config, values)) return
                    await apiCall('set_plugin', { id, config: values })
                    toast("Configuration saved")
                }
            }),
            h(IconBtn, {
                icon: Delete,
                title: "Uninstall",
                size: 'small',
                confirm: "Remove?",
                async onClick() {
                    await apiCall('uninstall_plugin', { id })
                    toast("Plugin uninstalled")
                }
            }),
        ]
    })
}

export function renderName({ row, value }: any) {
    const { repo } = row
    return h(Fragment, {},
        errorIcon(row.badApi, true),
        errorIcon(row.error),
        repo?.includes('//') ? h(Link, { href: repo, target: 'plugin' }, value)
            : !repo ? value
                : with_(repo?.split('/'), arr => h(Fragment, {},
                    h(Link, { href: 'https://github.com/' + repo, target: 'plugin' }, arr[1]),
                    '\xa0by ', arr[0]
                ))
    )

    function errorIcon(msg: ReactNode, warning=false) {
        return msg && h(Tooltip, {
            title: msg,
            children: h(Error, { fontSize: 'small', color: warning ? 'warning' : 'error', sx: { ml: -.5, mr: .5 } })
        })
    }
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

export function showError(error: any) {
    return h(Alert, { severity: 'error' }, xlate(error, {
        github_quota: "Request denied. You may have reached the limit, retry later.",
        ENOTFOUND: "Couldn't reach github.com",
    }))
}

export function UpdateButton({ id, updated, then }: { id: string, updated?: boolean, then: (id:string)=>void }) {
    return h(IconBtn, {
        icon: Upgrade,
        title: updated ? "Already updated" : "Update",
        disabled: updated,
        async onClick() {
            await apiCall('update_plugin', { id }, { timeout: false })
            then?.(id)
            toast("Plugin updated")
        }
    })
}

export async function startPlugin(id: string) {
    await apiCall('start_plugin', { id })
    toast("Plugin started", h(PlayCircle, { color: 'success' }))
}

import { createElement as h, Fragment } from "react"
import { apiCall, useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { Alert, Box, Tooltip } from '@mui/material'
import { IconBtn } from './misc'
import { Error, PlayCircle, Settings, StopCircle } from '@mui/icons-material'
import { toast, formDialog } from './dialog'
import { BoolField, Field, MultiSelectField, NumberField, SelectField, StringField } from './Form'
import { ArrayField } from './ArrayField'
import _ from "lodash"

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
                minWidth: 150,
                renderCell({ row, value }) {
                    return h(Fragment, {},
                        value,
                        typeof row.badApi === 'string' && h(Tooltip, { title: row.badApi, children: h(Error, { color: 'warning', sx: { ml: 1 } }) })
                    )
                }
            },
            {
                field: 'started',
                width: 180,
                valueFormatter: ({ value }) => !value ? "off" : new Date(value as string).toLocaleString()
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
                renderCell({ row }) {
                    const { config, id } = row
                    return h('div', {},
                        h(IconBtn, row.started ? {
                            icon: StopCircle,
                            title: `Stop ${id}`,
                            onClick: () =>
                                apiCall('set_plugin', { id, enabled: false }).then(() =>
                                    toast("Plugin is stopping", h(StopCircle, { color: 'warning' })))
                        } : {
                            icon: PlayCircle,
                            title: `Start ${id}`,
                            onClick: () =>
                                apiCall('set_plugin', { id, enabled: true }).then(() =>
                                    toast("Plugin is starting", h(PlayCircle, { color: 'success' }))),
                        }),
                        h(IconBtn, {
                            icon: Settings,
                            title: "Configuration",
                            disabled: !config,
                            async onClick() {
                                const pl = await apiCall('get_plugin', { id })
                                const values = await formDialog({
                                    title: `${id} configuration`,
                                    fields: [ h(Box, {}, row.description), ...makeFields(config) ],
                                    values: pl.config,
                                    ...row.configDialog,
                                })
                                if (values)
                                    await apiCall('set_plugin', { id, config: values })
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
        let { type, defaultValue, fields, ...rest } = o
        const comp = (type2comp as any)[type] as Field<any> | undefined
        if (comp === ArrayField)
            fields = makeFields(fields)
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
}

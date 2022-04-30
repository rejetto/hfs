import { createElement as h } from "react"
import { apiCall, useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { Alert, Box } from '@mui/material'
import { IconBtn } from './misc'
import { PowerSettingsNew, Settings } from '@mui/icons-material'
import { alertDialog, formDialog } from './dialog'
import { BoolField, Field, MultiSelectField, NumberField, SelectField, StringField } from './Form'
import { ArrayField } from './ArrayField'

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
                        h(IconBtn, {
                            icon: PowerSettingsNew,
                            title: (row.started ? "Stop" : "Start") + ' ' + id,
                            onClick: () =>
                                apiCall('set_plugin', { id, enabled: !row.started }).then(() =>
                                    alertDialog(row.started ? "Plugin is stopping" : "Plugin is starting")),
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
        const comp = (type2comp as any)[o?.type] as Field<any> | undefined
        // @ts-ignore
        if (comp === ArrayField)
            o.fields = makeFields(o.fields)
        return { k, comp, ...(typeof o === 'object' ? o : null) }
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

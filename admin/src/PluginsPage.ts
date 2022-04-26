import { createElement as h, FC, isValidElement } from "react"
import { apiCall, useApiComp, useApiList } from './api'
import { DataGrid } from '@mui/x-data-grid'
import { Alert } from '@mui/material'
import { IconBtn } from './misc'
import { PowerSettingsNew, Settings } from '@mui/icons-material'
import { alertDialog, formDialog } from './dialog'
import { BoolField, MultiSelectField, NumberField, SelectField, StringField } from './Form'

const PLUGINS_CONFIG = 'plugins_config'

export default function PluginsPage() {
    const { list, error, initializing } = useApiList('get_plugins')
    const [cfgRes, reloadCfg] = useApiComp('get_config', { only: [PLUGINS_CONFIG] })
    if (isValidElement(cfgRes))
        return cfgRes
    if (error)
        return h(Alert, { severity: 'error' }, error)
    const cfg = cfgRes[PLUGINS_CONFIG]
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
                            onClick() {
                                formDialog({
                                    title: `${id} configuration`,
                                    fields: makeFields(config),
                                    values: cfg?.[id],
                                }).then(config => {
                                    if (config)
                                        apiCall('set_plugin', { id, config }).then(reloadCfg)
                                })
                            }
                        }),
                    )
                }
            },
        ]
    })
}

function makeFields(config: any) {
    return Object.entries(config).map(([k,o]) => {
        const comp = (type2comp as any)[(o as any)?.type] as FC | undefined
        return ({ k, comp, ...(typeof o === 'object' ? o : null) })
    })
}

const type2comp = {
    string: StringField,
    number: NumberField,
    boolean: BoolField,
    select: SelectField,
    multiselect: MultiSelectField,
}

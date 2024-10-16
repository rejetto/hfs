// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiEx, useApiList } from './api'
import { createElement as h, Fragment, useEffect } from 'react'
import { Box, Link } from '@mui/material'
import { DataTable, DataTableColumn } from './DataTable'
import {
    Clear,
    Delete,
    Error as ErrorIcon,
    FormatPaint as ThemeIcon,
    PlayCircle,
    Settings,
    StopCircle,
    Upgrade
} from '@mui/icons-material'
import { HTTP_FAILED_DEPENDENCY, md, newObj, prefix, with_, xlate } from './misc'
import { alertDialog, confirmDialog, formDialog, toast } from './dialog'
import _ from 'lodash'
import { Account } from './AccountsPage'
import { BoolField, Field, FieldProps, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import FileField from './FileField'
import { PLUGIN_ERRORS } from './PluginsPage'
import { Btn, hTooltip, IconBtn, iconTooltip } from './mui'
import VfsPathField from './VfsPathField'

export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, error, updateList, initializing } = useApiList(updates ? 'get_plugin_updates' : 'get_plugins')
    useEffect(() => {
        if (!initializing)
            updateList(list =>
                _.sortBy(list, x => (x.started || x.error ? '0' : '1') + treatPluginName(x.id)))
    }, [initializing]);
    const size = 'small'
    return h(DataTable, {
        error: xlate(error, PLUGIN_ERRORS),
        rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
        initializing,
        disableColumnSelector: true,
        noRows: updates && `No updates available. Only plugins available on "search online" are checked.`,
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
                minWidth: 150,
                renderCell: renderName,
                valueGetter({ row }) { return row.repo || row.id },
                mergeRender: { description: { fontSize: 'x-small' } }
            },
            {
                field: 'version',
                width: 70,
                hideUnder: 'sm',
            },
            themeField,
            {
                ...descriptionField,
                flex: 1,
                hideUnder: 'sm',
            },
        ],
        actions: ({ row, id }) => updates ? [
            h(IconBtn, {
                icon: Upgrade,
                title: row.downloading ? "Downloading" : row.updated ? "Already updated" : "Update",
                disabled: row.updated,
                progress: row.downloading,
                size,
                async onClick() {
                    await apiCall('update_plugin', { id, branch: row.branch }, { timeout: false }).catch(e => {
                        throw e.code !== HTTP_FAILED_DEPENDENCY ? e
                            : Error("Failed dependencies: " + e.cause?.map((x: any) => prefix(`plugin "`, x.id || x.repo, `" `) + x.error).join('; '))
                    })
                    toast("Plugin updated")
                }
            })
        ] : [
            h(IconBtn, row.started ? {
                icon: StopCircle,
                title: h(Box, { 'aria-hidden': true }, `Stop ${id}`, h('br'), `Started ` + new Date(row.started as string).toLocaleString()),
                'aria-label': `Stop ${id}`,
                size,
                color: 'success',
                async onClick() {
                    await apiCall('stop_plugin', { id })
                    toast("Plugin stopped", h(StopCircle, { color: 'warning' }))
                }
            } : {
                icon: PlayCircle,
                title: `Start ${id}`,
                size,
                onClick: () => startPlugin(id),
            }),
            h(IconBtn, {
                icon: Settings,
                title: "Options",
                size,
                disabled: !row.started && "Start plugin to access options"
                    || !row.config && "No options available for this plugin",
                progress: false,
                async onClick() {
                    const { config: lastSaved } = await apiCall('get_plugin', { id })
                    const values = await formDialog({
                        title: `Options for ${id}`,
                        form: values => ({
                            before: h(Box, { mx: 2, mb: 3 }, row.description),
                            fields: makeFields(row.config),
                            save: { children: "Save and close" },
                            barSx: { gap: 1 },
                            addToBar: [h(Btn, { variant: 'outlined', onClick: () => save(values) }, "Save")],
                        }),
                        values: lastSaved,
                        dialogProps: _.merge({ maxWidth: 'md', sx: { m: 'auto' } }, // center content when it is smaller than mobile (because of full-screen)
                            with_(row.configDialog?.maxWidth, x => x?.length === 2 ? { maxWidth: x } : x ? { sx: { maxWidth: x } } : null), // this makes maxWidth support css values without having to wrap in sx, as in DialogProps it only supports breakpoints
                            row.configDialog),
                    })
                    if (values && !_.isEqual(lastSaved, values))
                        return save(values)

                    async function save(values: any) {
                        await apiCall('set_plugin', { id, config: values })
                        Object.assign(lastSaved, values)
                        toast("Configuration saved")
                    }
                }
            }),
            h(IconBtn, {
                icon: Delete,
                title: "Uninstall",
                size,
                async onClick() {
                    const res = await confirmDialog(`${id}: delete configuration too?`, {
                        trueText: "Yes",
                        falseText: "No",
                        after: ({ onClick }) => h(Btn, { variant: 'outlined', onClick(){ onClick(undefined) } }, "Abort")
                    })
                    if (res === undefined) return
                    await apiCall('uninstall_plugin', { id, deleteConfig: res })
                    toast("Plugin uninstalled")
                }
            }),
        ]
    })
}

// hide the hfs- prefix, as one may want to use it for its repository, because github is the context, but in the hfs context the prefix it's not only redundant, but also ruins the sorting
function treatPluginName(name: string) {
    return name.replace(/hfs-/, '')
}

export function renderName({ row, value }: any) {
    const { repo } = row
    return h(Fragment, {},
        row.downgrade && errorIcon("This version is older than the one you installed. It is possible that the author found a problem with your version and decided to retire it.", true),
        errorIcon(row.error || row.badApi, !row.error),
        repo?.includes('//') ? h(Link, { href: repo, target: 'plugin' }, value)
            : with_(repo?.split('/'), arr => arr?.length !== 2 ? value
                : h(Fragment, {},
                    h(Link, { href: 'https://github.com/' + repo, target: 'plugin', onClick(ev) { ev.stopPropagation() } }, treatPluginName(arr[1])),
                    '\xa0by ', arr[0]
                ))
)

    function errorIcon(msg: string, warning=false) {
        return msg && hTooltip(msg, msg, h(ErrorIcon, { fontSize: 'small', color: warning ? 'warning' : 'error', sx: { ml: -.5, mr: .5 } }))
    }
}

function makeFields(config: any) {
    return Object.entries(config).map(([k,o]: [string,any]) => {
        if (!_.isPlainObject(o))
            return o
        let { type, defaultValue, fields, frontend, helperText, ...rest } = o
        if (helperText)
            helperText = md(helperText, { html: false })
        const comp = (type2comp as any)[type] as Field<any> | undefined
        if (comp === ArrayField) {
            rest.valuesForAdd = newObj(fields, x => x.defaultValue)
            fields = makeFields(fields)
        }
        if (defaultValue !== undefined && type === 'boolean')
            rest.placeholder = `Default value is ${JSON.stringify(defaultValue)}`
        return { k, comp, fields, helperText, ...rest }
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
    vfs_path: VfsPathField,
    username: UsernameField,
    color: ColorField,
}

export async function startPlugin(id: string) {
    try {
        await apiCall('start_plugin', { id })
        toast("Plugin started", h(PlayCircle, { color: 'success' }))
        return true
    }
    catch(e: any) {
        alertDialog(`Plugin ${id} didn't start, with error: ${String(e?.message || e)}`, 'error')
    }
}

function UsernameField({ value, onChange, multiple, groups, ...rest }: FieldProps<string>) {
    const { data, element, loading } = useApiEx<{ list: Account[] }>('get_accounts')
    return !loading && element || h((multiple ? MultiSelectField : SelectField) as Field<string>, {
        value, onChange,
        options: data?.list.filter(x => groups === undefined || groups === !x.hasPassword).map(x => x.username),
        ...rest,
    })
}

function ColorField(rest: FieldProps<string>) {
    return h(StringField, {
        inputProps: { type: 'color', style: { marginRight: 24 }, ...!rest.value && { value: '#888888', style: { zIndex: 1, opacity: .1  } } },
        InputProps: { endAdornment: rest.value ? h(Btn, {
            icon: Clear,
            size: 'small',
            sx: { position: 'absolute', right: 4 },
            title: "Clear",
            onClick(event) {
                rest.onChange(undefined as any, { was: rest.value, event: event })
            }
        }) : h(Box, {
                sx: {
                    position: 'absolute',
                    width: '100%',
                    bottom: 2,
                    pt: '3px',
                    textAlign: 'center',
                    color: '#fff',
                    background: 'repeating-linear-gradient(45deg, #333, #333 10px, #444 10px, #444 20px)',
                }
            }, "default") },
        typing: true,
        ...rest,
    })
}

export const descriptionField: DataTableColumn = {
    field: 'description',
    mergeRender: { isTheme: {} } ,
    mergeRenderSx: { float: 'left' },
}

export const themeField: DataTableColumn = {
    field: 'isTheme',
    headerName: "is theme",
    hidden: true,
    dialogHidden: true,
    type: 'boolean',
    renderCell({ value }) {
        return value && iconTooltip(ThemeIcon, _.isString(value) ? `${value} theme` : "theme", { fontSize: '1.2rem', mr: '.3em' })
    }
}
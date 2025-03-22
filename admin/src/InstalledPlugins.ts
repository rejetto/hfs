// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, useApiEx, useApiList } from './api'
import { createElement as h, Fragment, useEffect } from 'react'
import { Box, Breakpoint, Link, Paper, Table, TableCell, TableRow, useTheme } from '@mui/material'
import { DataTable, DataTableColumn } from './DataTable'
import {
    Clear, Delete, Error as ErrorIcon, FormatPaint as ThemeIcon, ListAlt, PlayCircle, Settings, StopCircle, Upgrade
} from '@mui/icons-material'
import {
    CFG, Html, HTTP_FAILED_DEPENDENCY, md, newObj, prefix, with_, xlate, formatTime, formatDate, replaceStringToReact,
    callable, tryJson
} from './misc'
import { alertDialog, confirmDialog, formDialog, toast } from './dialog'
import _ from 'lodash'
import { Account } from './AccountsPage'
import { BoolField, Field, FieldProps, MultiSelectField, NumberField, SelectField, StringField } from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import FileField from './FileField'
import { PLUGIN_ERRORS } from './PluginsPage'
import { Btn, Flex, hTooltip, IconBtn, iconTooltip, usePauseButton } from './mui'
import VfsPathField from './VfsPathField'
import { DateTimeField } from './DateTimeField'

// updates=true will show the "check updates" version of the page
export default function InstalledPlugins({ updates }: { updates?: true }) {
    const { list, error, setList, initializing } = useApiList(updates ? 'get_plugin_updates' : 'get_plugins', {}, {
        map(x: any) { x.config &&= tryJson(x.config, s => eval('()=>('+s+')')()) }
    })
    useEffect(() => {
        setList(list =>
            _.sortBy(list, x => (x.error ? 0 : x.started ? 1 : 2) + treatPluginName(x.id)))
    }, [list.length]);
    const size = 'small'
    const { pause, pauseButton } = usePauseButton("plugins", () => getSingleConfig(CFG.suspend_plugins).then(x => !x), {
        onClick: () => apiCall('set_config', { values: { [CFG.suspend_plugins]: !pause } })
    })
    const theme = useTheme()
    return h(DataTable, {
        error: xlate(error, PLUGIN_ERRORS),
        rows: list.length ? list : [], // workaround for DataGrid bug causing 'no rows' message to be not displayed after 'loading' was also used
        fillFlex: true,
        initializing,
        disableColumnSelector: true,
        getRowHeight: updates && (({ model }) => model.changelog ? 'auto' as const : 50),
        noRows: updates && `No updates available. Only plugins available on "search online" are checked.`,
        columns: [
            {
                field: 'id',
                headerName: "name",
                flex: .3,
                minWidth: 150,
                renderCell: renderName,
                valueGetter({ row }) { return row.repo || row.id },
                mergeRender: { [updates ? 'changelog' : 'description']: { fontSize: 'x-small' } }
            },
            {
                field: 'version',
                width: 70,
                hideUnder: 'sm',
                mergeRender: { installedVersion: { fontSize: 'x-small' } }
            },
            themeField,
            {
                ...descriptionField,
                flex: 1,
                hideUnder: 'sm',
            },
            {
                field: 'installedVersion',
                hideUnder: true,
                dialogHidden: true,
                renderCell: ({ value }) => value && `Yours ${value}`
            },
            {
                field: 'changelog',
                headerName: "Change log",
                flex: 2,
                hideUnder: !updates || 'sm',
                sx: { flexDirection: 'column', alignItems: 'flex-start' },
                renderCell({ value, row }) {
                    if (!Array.isArray(value)) return null
                    return h(Table, { sx: { td: { p: 0 } } },
                        _.uniq(_.sortBy(value, 'version').filter(x => _.isString(x.message) && x.message && x.version > row.installedVersion))
                            .map((x, i) => h(TableRow, { key: i },
                                h(TableCell, {}, "• ", x.version, ': '),
                                h(TableCell, {}, md(x.message))
                            ))
                    )
                }
            }
        ],
        footerSide: () => !updates && pauseButton,
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
                doneAnimation: true,
                onClick: () => apiCall('stop_plugin', { id }),
            } : {
                icon: PlayCircle,
                title: `Start ${id}`,
                disabled: pause,
                size,
                onClick: () => startPlugin(id),
            }),
            h(IconBtn, {
                icon: row.config || !row.started || !row.log ? Settings : ListAlt,
                title: row.config || !row.log ? "Options" : "Log",
                size,
                disabled: !row.started && "Start plugin to access options"
                    || !row.config && !row.log && "No options and no log for this plugin",
                async onClick() {
                    const { config: lastSaved } = await apiCall('get_plugin', { id })
                    // support css values without having to wrap in sx, as in DialogProps it only supports breakpoints
                    let maxWidth = with_(row.configDialog, x => theme.breakpoints.values[x?.maxWidth as Breakpoint] || x?.sx?.maxWidth || xlate(x?.maxWidth, { xs: 0 }) || 432)
                    if (typeof maxWidth === 'number')  // @ts-ignore
                        maxWidth += 'px'
                    const showOptions = Boolean(row.config)
                    const values = await formDialog({
                        title: showOptions ? `Options for ${id}` : `Log for ${id}`,
                        form: values => ({
                            before: row.description && h(Box, { mx: 2, mb: 2 }, row.description),
                            fields: makeFields(callable(row.config, values) || {}, values),
                            save: showOptions ? { children: "Save and close" } : false,
                            barSx: { gap: 1 },
                            addToBar: [h(Btn, { variant: 'outlined', onClick: () => save(values) }, "Save")],
                        }),
                        values: lastSaved,
                        dialogProps: _.merge({ maxWidth: 'md', sx: { m: 'auto' } }, // center content when it is smaller than mobile (because of full-screen)
                            row.configDialog,
                            { maxWidth: false,  sx: { maxWidth: null } }, // cancel maxWidth to move it to the Box below
                        ),
                        Wrapper({ children }: any) {
                            const { list } = useApiList('get_plugin_log', { id }, {
                                invert: true,
                                map(x) { x.ts = new Date(x.ts) }
                            })
                            let lastDate: any
                            return h(Flex, { alignItems: 'stretch', justifyContent: 'center', flexWrap: 'wrap', flexDirection: showOptions ? undefined : 'column' },
                                h(Box, { maxWidth, minWidth: 'min-content' /*in case content requires more space (eg: reverse-proxy's table)*/ }, children),
                                list.length > 0 ? h(Paper, { elevation: 1, sx: { position: 'relative', fontFamily: 'monospace', flex: 1, minWidth: 'min(40em, 90vw)', minHeight: '20em', px: .5 } },
                                    h(Box, { my: .5, pb: .5, borderBottom: '1px solid' }, "Output (last on top)"),
                                    h(Box, { position: 'absolute', bottom: 0, top: '1.8em', left: 0, right: 0, sx: { overflowY: 'auto' } },
                                        h(Box, {
                                            sx: {
                                                textIndent: '-1em', pl: '1em',
                                                position: 'absolute', width: 'calc(100% - 1.2em)', ml: '2px', pt: '.2em',
                                            }
                                        }, list.map(x => {
                                            formatDate(x.ts)
                                                const thisDate = formatDate(x.ts)
                                                return h(Fragment, { key: x.id },
                                                    thisDate !== lastDate && (lastDate = thisDate),
                                                    h(Box, {},
                                                        h(Box, { title: thisDate, display: 'inline', color: 'text.secondary', mr: 1 }, formatTime(x.ts)),
                                                        replaceStringToReact(x.msg, /https?:\/\/\S+/, m => h(Link, {
                                                            href: m[0],
                                                            target: '_blank'
                                                        }, m[0])) // make links clickable
                                                    )
                                                )
                                            }
                                        ))
                                    )
                                ) : showOptions ? null : h(Box, { p: '1em', pt: 0 }, "Log is empty")
                            )
                        }
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

function getSingleConfig(k: string) {
    return apiCall('get_config', { only: [k] }).then(x => x[k])
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

function makeFields(config: any, values: any) {
    return Object.entries(config).map(([k,o]: [string,any]) => {
        if (!o) return
        let { type, defaultValue, frontend, showIf, ...rest } = o
        try {
            if (typeof showIf === 'string') // compile once
                rest.showIf = showIf = eval(showIf) // eval is normally considered a threat, but this code is coming from a plugin that's already running on your server, so you already decided to trust it. Here it will run in your browser, and inside the page that administrating the same server.
            if (showIf && !showIf(values))
                return
        }
        catch {}
        rest.helperText &&= md(rest.helperText, { html: false })
        const comp = (type2comp as any)[type] as Field<any> | undefined
        if (values === false && type === 'date_time')
            rest.$type = 'dateTime'
        if (comp === ArrayField) {
            let {fields} = rest
            rest.valuesForAdd = newObj(callable(fields, false), x => x.defaultValue)
            if (typeof fields === 'string')
                fields = eval(fields)
            rest.details ??= false
            rest.fields = (values: unknown) => _.map(makeFields(callable(fields, values), values), (v,k) => v && ({ k, ...v, defaultValue: undefined })).filter(Boolean)
        }
        if (defaultValue !== undefined && type === 'boolean')
            rest.placeholder = `Default value is ${JSON.stringify(defaultValue)}`
        return { k, comp, ...rest }
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
    showHtml: ({ html }: any) => h(Html, {}, String(html)),
    date_time: DateTimeField,
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
        options: data?.list.filter(x => groups === undefined || groups === x.isGroup).map(x => x.username),
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
                rest.onChange(null as any, { was: rest.value, event: event })
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
    hideUnder: true,
    dialogHidden: true,
    type: 'boolean',
    renderCell({ value }) {
        return value && iconTooltip(ThemeIcon, _.isString(value) ? `${value} theme` : "theme", { fontSize: '1.2rem', mr: '.3em' })
    }
}
import { apiCall } from '@hfs/shared/api'
import { createElement as h, Fragment, useMemo } from 'react'
import { Box, Link, Paper } from '@mui/material'
import { callable, formatDate, formatTime, newObj } from '../../src/cross'
import { Btn, Flex, iconTooltip, NetmaskField } from './mui'
import { MilitaryTech, Clear } from '@mui/icons-material'
import { Html, md, replaceStringToReact, useAutoScroll } from '@hfs/shared'
import {
    BoolField, Field, FieldProps, MultiSelectField, NumberField, SelectField, StringField, FormApi
} from '@hfs/mui-grid-form'
import { ArrayField } from './ArrayField'
import _ from 'lodash'
import FileField from './FileField'
import VfsPathField from './VfsPathField'
import { DateTimeField } from './DateTimeField'
import { formDialog, toast } from './dialog'
import { useApiEx, useApiList } from './api'
import { adminApis } from '../../src/adminApis'
import { Account, account2icon } from './AccountsPage'

export async function showPluginOptions(row: any, maxWidth: string) {
    const {id} = row
    const { config: lastSaved } = await apiCall('get_plugin', { id })
    const apiRef = { current: undefined as FormApi | undefined }
    // support css values without having to wrap in sx, as in DialogProps it only supports breakpoints
    const showOptions = Boolean(row.config)
    const values = await formDialog({
        title: showOptions ? `Options for ${id}` : `Log for ${id}`,
        form: values => ({
            before: row.description && h(Box, { mx: 2, mb: 2 }, row.description),
            fields: makeFields(callable(row.config, values) || {}, values),
            save: showOptions ? { children: "Save and close" } : false,
            barSx: { gap: 1 },
            apiRef,
            addToBar: [h(Btn, {
                variant: 'outlined',
                async onClick() {
                    // this action must reuse form validation without falling through to the dialog-closing submit path
                    if (await apiRef.current?.validate())
                        await save(values)
                }
            }, "Save")],
        }),
        values: lastSaved,
        dialogProps: _.merge({ maxWidth: 'md', sx: { m: 'auto' } }, // center content when it is smaller than mobile (because of full-screen)
            row.configDialog,
            { maxWidth: false,  sx: { maxWidth: null } }, // cancel maxWidth to move it to the Box below
        ),
        Wrapper({ children }: any) {
            const { list, setList } = useApiList('get_plugin_log', { id }, {
                map(x) { x.ts = new Date(x.ts) }
            })
            const autoScroll = useAutoScroll(list)
            let lastDate: any
            return h(Flex, { alignItems: 'stretch', justifyContent: 'center', flexWrap: 'wrap', flexDirection: showOptions ? undefined : 'column' },
                h(Box, { maxWidth, minWidth: 'min-content' /*in case content requires more space (eg: reverse-proxy's table)*/ }, children),
                h(Paper, { elevation: 1, sx: { position: 'relative', fontFamily: 'monospace', flex: 1, minWidth: 'min(40em, 90vw)', minHeight: '20em', px: .5 } },
                    h(Box, { my: .5, pb: .5, borderBottom: '1px solid', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
                        "Output",
                        h(Btn, { size: 'small', sx: { p: 0 }, onClick() { setList([]) } }, "Clear")
                    ),
                    h(Box, {
                            position: 'absolute', bottom: 0, top: '31px', left: 0, right: 0, sx: { overflowY: 'auto' },
                            ref: autoScroll,
                        },
                        !list.length && h(Box, { p: 1 }, "Log is empty"),
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
                        }))
                    )
                )
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

function makeFields(config: any, values: any) {
    return Object.entries(config).map(([k,o]: [string,any]) => {
        if (!o) return
        let { type, defaultValue, frontend, showIf, ...rest } = o
        try {
            rest.getError = evalWrapper(rest.getError)
            if (typeof showIf === 'string')
                o.showIf = // compile once
                    showIf = evalWrapper(showIf) // eval is normally considered a threat, but this code is coming from a plugin that's already running on your server, so you already decided to trust it. Here it will run in your browser, and inside the page that administrating the same server.
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
                fields = evalWrapper(fields)
            rest.details ??= false
            rest.fields = (values: unknown) => _.map(makeFields(callable(fields, values), values), (v,k) => v && ({ k, ...v, defaultValue: undefined })).filter(Boolean)
        }
        if (defaultValue !== undefined && type === 'boolean')
            rest.placeholder = `Default value is ${JSON.stringify(defaultValue)}`
        return { k, comp, ...rest }
    })
}

// centralize usage of eval get a single warning at build time
export function evalWrapper(s: string) {
    return eval(s)
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
    show_html: ({ html }: any) => h(Html, {}, String(html)),
    date_time: DateTimeField,
    net_mask: NetmaskField,
}
;(type2comp as any).showHtml = type2comp.show_html // legacy pre 3.1.0

function UsernameField({ value, onChange, multiple, groups, ...rest }: FieldProps<string>) {
    const { data, element, loading } = useApiEx<typeof adminApis.get_accounts>('get_accounts')
    const list = useMemo(() => data && _.sortBy(data.list, [x => !x.isGroup, x => !x.adminActualAccess, 'username']), [data])
    type UsernameOption = { value: string, label: string, a?: Account } // an account may be passed as value but not exist (anymore)
    return (!loading || !data) && element || h((multiple ? MultiSelectField : SelectField) as Field<string>, {
        value, onChange,
        options: list?.filter(x => groups === undefined || groups === x.isGroup).map(a => ({ value: a.username, label: a.username, a })),
        renderOption: (x: UsernameOption) => {
            if (!x.a)
                return h('span', { style: { textDecoration: 'line-through' } }, x.label)
            const icon = x.a.isGroup && account2icon(x.a) || x.a.adminActualAccess && iconTooltip(MilitaryTech, "Can login into Admin")
            return !icon ? x.label
                : h('span', {},
                    h('span', { style: { marginLeft: -8, marginRight: 8 } }, icon),
                    x.label)
        },
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

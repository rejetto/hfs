// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state } from './state'
import { createElement as h, useEffect, useMemo, useState } from 'react'
import { Alert, Button } from '@mui/material'
import { BoolField, DisplayField, Field, FieldProps, Form, MultiSelectField, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { formatBytes, isEqualLax, modifiedSx, onlyTruthy } from './misc'
import { reloadVfs, VfsNode, Who } from './VfsPage'
import md from './md'
import _ from 'lodash'
import FileField from './FileField'
import { alertDialog } from './dialog'

interface Account { username: string }

export default function FileForm({ file }: { file: VfsNode }) {
    const { parent, children, isRoot, ...rest } = file
    const [values, setValues] = useState(rest)
    useEffect(() => {
        setValues(Object.assign({ can_see: null, can_read: null }, rest))
    }, [file]) //eslint-disable-line

    const { source } = file
    const isDir = file.type === 'folder'
    const hasSource = source !== undefined // we need a boolean
    const realFolder = hasSource && isDir
    const inheritedPerms = useMemo(() => {
        const ret = { can_read: true, can_see: true }
        // reconstruct parents backward
        const parents = []
        let run = parent
        while (run) {
            parents.unshift(run)
            run = run.parent
        }
        for (const node of parents)
            Object.assign(ret, node)
        return ret
    }, [parent])
    const showCanSee = (values.can_read ?? inheritedPerms.can_read) === true
    const showTimestamps = hasSource && Boolean(values.ctime)

    const { data, element } = useApiEx<{ list: Account[] }>('get_accounts')
    if (element || !data)
        return element
    const accounts = data.list

    return h(Form, {
        values,
        set(v, k) {
            setValues({ ...values, [k]: v })
        },
        addToBar: [
            h(Button, { // not really useful, but users misled in thinking it's a dialog will find satisfaction in dismissing the form
                sx: { ml: 2 },
                onClick(){
                    state.selectedFiles = []
                }
            }, "Close")
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx(!isEqualLax(values, file)),
            async onClick() {
                const props = { ...values }
                if (!props.masks)
                    props.masks = null // undefined cannot be serialized
                if (!isRoot)
                    delete props.source
                await apiCall('set_vfs', {
                    uri: values.id,
                    props,
                })
                if (props.name !== file.name) // when the name changes, the id of the selected file is changing too, and we have to update it in the state if we want it to be correctly re-selected after reload
                    state.selectedFiles[0].id = file.id.slice(0, -file.name.length) + props.name
                reloadVfs()
            }
        },
        fields: [
            isRoot ? h(Alert,{ severity: 'info' }, "This is Home, the root of your shared files. Options set here will be applied to all files.")
                : { k: 'name', required: true, helperText: source && "You can decide a name that's different from the one on your disk" },
            isRoot ? { k: 'source', comp: FileField, files: false,  helperText: "If you specify a folder here, its files will be listed in the home" }
                : (hasSource && { k: 'source', comp: DisplayField, multiline: true }),
            !isRoot && { k: 'can_read', label:"Who can download", xl: showCanSee && 6, comp: WhoField, parent, accounts, inherit: inheritedPerms.can_read,
                helperText: "Note: who can't download won't see it in the list"
            },
            showCanSee && { k: 'can_see', label:"Who can see", xl: 6, comp: WhoField, parent, accounts, inherit: inheritedPerms.can_see,
                helperText: "If you hide this element it will not be listed, but will still be accessible if you have a direct link"
            },
            hasSource && !realFolder && { k: 'size', comp: DisplayField, toField: formatBytes },
            showTimestamps && { k: 'ctime', comp: DisplayField, lg: 6, label: 'Created', toField: formatTimestamp },
            showTimestamps && { k: 'mtime', comp: DisplayField, lg: 6, label: 'Modified', toField: formatTimestamp },
            file.website && { k: 'default', comp: BoolField, label:"Serve index.html",
                toField: Boolean, fromField: (v:boolean) => v ? 'index.html' : null,
                helperText: md("This folder may be a website because contains `index.html`. Enabling this will show the website instead of the list of files.")
            },
            isDir && { k: 'masks', multiline: true, xl: true, toField: JSON.stringify, fromField: v => v ? JSON.parse(v) : undefined,
                helperText: "This is a special field. Leave it empty unless you know what you are doing." }
        ]
    })
}

function formatTimestamp(x: string) {
    return x ? new Date(x).toLocaleString() : '-'
}

interface WhoFieldProps extends FieldProps<Who> { accounts: Account[] }
function WhoField({ value, onChange, parent, inherit, accounts, helperText, ...rest }: WhoFieldProps) {
    const options = useMemo(() =>
        onlyTruthy([
            { value: null, label: (parent ? "Same as parent: " : "Default: " ) + who2desc(inherit === 0 ? true : inherit) },
            { value: true },
            { value: false },
            { value: '*' },
            { value: [], label: "Select accounts" },
        ].map(x => x && x.value !== inherit // don't offer inherited value twice
            && { label: _.capitalize(who2desc(x.value)), ...x })), // default label
    [inherit, parent])

    const arrayMode = Array.isArray(value)
    return h('div', {},
        h(SelectField as Field<Who>, {
            ...rest,
            helperText: !arrayMode && helperText,
            value: arrayMode ? [] : value,
            onChange(v, { was, event }) {
                onChange(v, { was , event })
            },
            options
        }),
        arrayMode && h(MultiSelectField as Field<string[]>, {
            label: accounts?.length ? "Choose accounts for " + rest.label : "You didn't create any account yet",
            value,
            onChange,
            helperText,
            options: accounts?.map(a => ({ value: a.username, label: a.username })) || [],
        })
    )
}

function who2desc(who: any) {
    return who === false ? "no one"
        : who === true ? "anyone"
            : who === '*' ? "any account (login required)"
                : Array.isArray(who) ? who.join(', ')
                    : "*UNKNOWN*" + JSON.stringify(who)
}

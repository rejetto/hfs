// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state } from './state'
import { createElement as h, ReactNode, useEffect, useMemo, useState } from 'react'
import { Alert } from '@mui/material'
import { BoolField, DisplayField, Field, FieldProps, Form, MultiSelectField, SelectField } from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import { formatBytes, IconBtn, isEqualLax, modifiedSx, onlyTruthy } from './misc'
import { reloadVfs, VfsNode, VfsPerms, Who } from './VfsPage'
import md from './md'
import _ from 'lodash'
import FileField from './FileField'
import { alertDialog, useDialogBarColors } from './dialog'
import yaml from 'yaml'
import { Delete } from '@mui/icons-material'

interface Account { username: string }

export default function FileForm({ file, defaultPerms, addToBar }: { file: VfsNode, defaultPerms: VfsPerms, addToBar?: ReactNode }) {
    const { parent, children, isRoot, ...rest } = file
    const [values, setValues] = useState(rest)
    useEffect(() => {
        setValues(Object.assign({ can_see: null, can_read: null, can_upload: null }, rest))
    }, [file]) //eslint-disable-line

    const { source } = file
    const isDir = file.type === 'folder'
    const hasSource = source !== undefined // we need a boolean
    const realFolder = hasSource && isDir
    const inheritedPerms = useMemo(() => {
        const ret = {}
        let run = parent
        while (run) {
            _.defaults(ret, run)
            run = run.parent
        }
        return _.defaults(ret, defaultPerms)
    }, [parent])
    const showCanSee = (values.can_read ?? inheritedPerms.can_read) === true
    const showTimestamps = hasSource && Boolean(values.ctime)
    const barColors = useDialogBarColors()

    const { data, element } = useApiEx<{ list: Account[] }>('get_accounts')
    if (element || !data)
        return element
    const accounts = data.list

    return h(Form, {
        values,
        set(v, k) {
            setValues({ ...values, [k]: v })
        },
        barSx: { gap: 2, width: '100%', ...barColors },
        stickyBar: true,
        addToBar: [
            !isRoot && h(IconBtn, {
                icon: Delete,
                title: "Delete",
                confirm: "Delete?",
                onClick: ()  => apiCall('del_vfs', { uris: [file.id] }).then(() => reloadVfs()),
            }),
            addToBar
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx(!isEqualLax(values, file)),
            async onClick() {
                const props = { ...values }
                if (!props.masks)
                    props.masks = null // undefined cannot be serialized
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
            { k: 'source', label: "Source on disk", comp: FileField, files: !isDir, folders: isDir, multiline: true,
                placeholder: "Not on disk, this is a virtual folder",
            },
            perm('can_read', "Who can download", "Note: who can't download won't see it in the list"),
            showCanSee && perm('can_see', "Who can see", "You can hide and keep it downloadable if you have a direct link"),
            isDir && perm('can_upload', "Who can upload", hasSource ? '' : "Works only on folders with source"),
            hasSource && !realFolder && { k: 'size', comp: DisplayField, lg: 4, toField: formatBytes },
            showTimestamps && { k: 'ctime', comp: DisplayField, md: 6, lg: 4, label: 'Created', toField: formatTimestamp },
            showTimestamps && { k: 'mtime', comp: DisplayField, md: 6, lg: 4, label: 'Modified', toField: formatTimestamp },
            file.website && { k: 'default', comp: BoolField, label:"Serve index.html",
                toField: Boolean, fromField: (v:boolean) => v ? 'index.html' : null,
                helperText: md("This folder may be a website because contains `index.html`. Enabling this will show the website instead of the list of files.")
            },
            isDir && { k: 'masks', multiline: true, xl: true, lg: 6,
                toField: yaml.stringify, fromField: v => v ? yaml.parse(v) : undefined,
                sx: { '& textarea': { fontFamily: 'monospace' } },
                helperText: "Special field, leave empty unless you know what you are doing. YAML syntax." }
        ]
    })

    function perm(perm: keyof typeof inheritedPerms, label: string, helperText='', props={}) {
        return { k: perm, lg: 6, comp: WhoField, parent, accounts, label, inherit: inheritedPerms[perm], helperText, ...props }
    }
}

function formatTimestamp(x: string) {
    return x ? new Date(x).toLocaleString() : '-'
}

interface WhoFieldProps extends FieldProps<Who> { accounts: Account[] }
function WhoField({ value, onChange, parent, inherit, accounts, helperText, ...rest }: WhoFieldProps) {
    const options = useMemo(() =>
        onlyTruthy([
            { value: null, label: (parent ? "Same as parent: " : "Default: " ) + who2desc(inherit) },
            { value: true },
            { value: false },
            { value: '*' },
            { value: [], label: "Select accounts" },
        ].map(x => (x.value === value || x.value !== inherit) // don't offer inherited value twice, unless it was already selected
            && { label: _.capitalize(who2desc(x.value)), ...x })), // default label
    [inherit, parent, value])

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

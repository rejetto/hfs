// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state } from './state'
import { createElement as h, ReactElement, ReactNode, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Collapse, FormHelperText, Link, MenuItem, MenuList, } from '@mui/material'
import {
    BoolField,
    DisplayField,
    Field,
    FieldProps,
    Form,
    MultiSelectField,
    SelectField,
    StringField
} from '@hfs/mui-grid-form'
import { apiCall, useApiEx } from './api'
import {
    basename, Btn, formatBytes, formatTimestamp, IconBtn, isEqualLax, LinkBtn, modifiedSx, newDialog, objSameKeys,
    onlyTruthy, prefix, wikiLink
} from './misc'
import { reloadVfs, VfsNode, VfsPerms, Who } from './VfsPage'
import md from './md'
import _ from 'lodash'
import FileField from './FileField'
import { alertDialog, toast, useDialogBarColors } from './dialog'
import yaml from 'yaml'
import { Check, ContentCopy, Delete, Edit, Save } from '@mui/icons-material'

interface Account { username: string }

interface FileFormProps {
    file: VfsNode
    anyMask?: boolean
    defaultPerms: VfsPerms
    addToBar?: ReactNode
    statusApi: any
}

const ACCEPT_LINK = "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/accept"

export default function FileForm({ file, anyMask, defaultPerms, addToBar, statusApi }: FileFormProps) {
    const { parent, children, isRoot, byMasks, ...rest } = file
    const [values, setValues] = useState(rest)
    useEffect(() => {
        setValues(Object.assign(objSameKeys(defaultPerms, () => null), rest))
    }, [file]) //eslint-disable-line

    const { source } = file
    const isDir = file.type === 'folder'
    const hasSource = source !== undefined // we need a boolean
    const realFolder = hasSource && isDir
    const inheritedPerms = useMemo(() => {
        const ret = {}
        let run = parent
        while (run) {
            _.defaults(ret, run, run.byMasks)
            run = run.parent
        }
        return _.defaults(ret, defaultPerms)
    }, [parent])
    const showTimestamps = hasSource && Boolean(values.ctime)
    const showSize = hasSource && !realFolder
    const showAccept = file.accept! > '' || isDir && (file.can_upload ?? inheritedPerms.can_upload)
    const barColors = useDialogBarColors()

    const { data, element } = useApiEx<{ list: Account[] }>('get_accounts')
    if (element || !data)
        return element
    const accounts = data.list

    const needSourceWarning = !hasSource && "Works only on folders with source! "
    return h(Form, {
        values,
        set(v, k) {
            if (k === 'link') return
            setValues(values => {
                const nameIsVirtual = k === 'source' && values.source?.endsWith(values.name)
                const name = nameIsVirtual ? basename(v) : values.name // update name if virtual
                return { ...values, name, [k]: v }
            })
        },
        barSx: { gap: 2, width: '100%', ...barColors },
        stickyBar: true,
        addToBar: [
            !isRoot && h(IconBtn, {
                icon: Delete,
                title: "Delete",
                confirm: "Delete?",
                onClick: () => apiCall('del_vfs', { uris: [file.id] }).then(() => reloadVfs()),
            }),
            addToBar
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx(!isEqualLax(values, rest)),
            async onClick() {
                const props = _.omit(values, ['ctime','mtime','size','id'])
                if (!props.masks)
                    props.masks = null // undefined cannot be serialized
                await apiCall('set_vfs', { uri: values.id, props })
                if (props.name !== file.name) // when the name changes, the id of the selected file is changing too, and we have to update it in the state if we want it to be correctly re-selected after reload
                    state.selectedFiles[0].id = file.parent!.id + props.name + (isDir ? '/' : '')
                reloadVfs()
            }
        },
        fields: [
            isRoot ? h(Alert,{ severity: 'info' }, "This is Home, the root of your shared files. Options set here will be applied to all files.")
                : { k: 'name', required: true, helperText: hasSource && "You can decide a name that's different from the one on your disk" },
            { k: 'id', comp: LinkField, statusApi },
            { k: 'source', label: "Source on disk", comp: FileField, files: !isDir, folders: isDir, multiline: true,
                helperText: !values.source && "Not on disk, this is a virtual folder",
            },
            perm('can_read', "Who can see but not download will be asked to login"),
            perm('can_see', "If you can't see, you may still download with a direct link"),
            isDir && perm('can_list', "Permission to see content of folders", { contentText: "subfolders" }),
            isDir && perm('can_delete', [needSourceWarning, "Those who can delete can also rename"]),
            isDir && perm('can_upload', needSourceWarning, { lg: showAccept ? 6 : 12, contentText: "subfolders" }),
            showAccept && { k: 'accept', label: "Accept on upload", placeholder: "anything", lg: 6,
                helperText: h(Link, { href: ACCEPT_LINK, target: '_blank' }, "Example: .zip") },
            showSize && { k: 'size', comp: DisplayField, lg: 4, toField: formatBytes },
            showTimestamps && { k: 'ctime', comp: DisplayField, md: 6, lg: showSize && 4, label: 'Created', toField: formatTimestamp },
            showTimestamps && { k: 'mtime', comp: DisplayField, md: 6, lg: showSize && 4, label: 'Modified', toField: formatTimestamp },
            file.website && { k: 'default', comp: BoolField, label:"Serve index.html",
                toField: Boolean, fromField: (v:boolean) => v ? 'index.html' : null,
                helperText: md("This folder may be a website because contains `index.html`. Enabling this will show the website instead of the list of files.")
            },
            isDir && { k: 'masks', multiline: true, lg: true,
                toField: yaml.stringify, fromField: v => v ? yaml.parse(v) : undefined,
                sx: { '& textarea': { fontFamily: 'monospace' } },
                helperText: ["Special field, leave empty unless you know what you are doing. YAML syntax. ", wikiLink('Permissions', "(examples)")]
            }
        ]
    })

    function perm(perm: keyof typeof inheritedPerms, helperText?: ReactNode, props: Partial<WhoFieldProps>={}) {
        return {
            showInherited: anyMask, // with masks, you may need to set a permission to override the mask
            otherPerms: _.without(Object.keys(defaultPerms), perm).map(x => ({ value: x, label: "As " +perm2word(x) })),
            k: perm, lg: 6, comp: WhoField, parent, accounts, helperText,
            label: "Who can " + perm2word(perm),
            inherit: inheritedPerms[perm],
            byMasks: byMasks?.[perm],
            isDir,
            ...props
        }
    }

}

function perm2word(perm: string) {
    const word = perm.split('_')[1]
    return word === 'read' ? 'download' : word
}

interface WhoFieldProps extends FieldProps<Who | undefined> {
    accounts: Account[],
    otherPerms: any[],
    isChildren?: boolean,
    isDir: boolean
    contentText?: string
}
function WhoField({ value, onChange, parent, inherit, accounts, helperText, showInherited, otherPerms, byMasks,
                      isChildren, isDir, contentText="folder content", setApi, ...rest }: WhoFieldProps): ReactElement {
    const defaultLabel = (byMasks !== undefined ? "As per mask: " : parent !== undefined ? "As parent: " : "Default: " )
        + who2desc(byMasks ?? inherit)
    const objectMode =  value != null && typeof value === 'object' && !Array.isArray(value)
    const childrenValue = objectMode && value.children
    const thisValue = objectMode ? value.this : value

    const options = useMemo(() =>
        onlyTruthy([
            { value: null, label: defaultLabel },
            { value: true },
            { value: false },
            { value: '*' },
            ...otherPerms,
            { value: [], label: "Select accounts" },
        // don't offer inherited value twice, unless it was already selected, or it is forced
        ].map(x => (x.value === thisValue || showInherited || x.value !== inherit)
            && { label: _.capitalize(who2desc(x.value)), ...x })), // default label
    [inherit, parent, thisValue])

    const timeout = 500
    const arrayMode = Array.isArray(thisValue)
    // a large side band will convey union across the fields
    return h(Box, { sx: { borderRight: objectMode ? '8px solid #8884' : undefined, transition: `all ${timeout}ms` } },
        h(SelectField as typeof SelectField<typeof thisValue>, {
            ...rest,
            value: arrayMode ? [] : thisValue,
            onChange(v, { event }) {
                onChange(objectMode ? { this: v, children: childrenValue } : v, { was: value, event })
            },
            options,
        }),
        h(Collapse, { in: arrayMode, timeout },
            arrayMode && h(MultiSelectField as Field<string[]>, {
                label: accounts?.length ? "Choose accounts for " + rest.label : "You didn't create any account yet",
                value: thisValue,
                onChange,
                options: accounts?.map(a => ({ value: a.username, label: a.username })) || [],
            }) ),
        h(FormHelperText, {},
            helperText,
            !isChildren && isDir && h(LinkBtn, {
                sx: { display: 'block', mt: -.5 },
                onClick(event) {
                    if (thisValue === undefined) return
                    onChange(objectMode ? thisValue : { this: value }, { was: value, event })
                }
            }, objectMode ? "Different permission for " : "Same permission for ", contentText)
        ),
        !isChildren && h(Collapse, { in: objectMode, timeout },
            h(WhoField, {
                label: "Permission for " + contentText,
                parent, inherit, accounts, showInherited, otherPerms, isDir,
                isChildren: true,
                value: childrenValue ?? null,
                onChange(v, { event }) {
                    onChange({ this: thisValue, children: v as any }, { was: value, event })
                }
            })
        ),
    )
}

function who2desc(who: any) {
    return who === false ? "no one"
        : who === true ? "anyone"
            : who === '*' ? "any account (login required)"
                : Array.isArray(who) ? who.join(', ')
                    : typeof who === 'string' ? "as " + perm2word(who)
                        : "*UNKNOWN*" + JSON.stringify(who)
}

interface LinkFieldProps extends FieldProps<string> {
    statusApi: any // receive status from parent, to avoid asking server at each click on a file
}
function LinkField({ value, statusApi }: LinkFieldProps) {
    const { data, reload, error } = statusApi
    const urls: string[] = data?.urls.https || data?.urls.http
    const link = (data?.baseUrl || urls?.[0] || '') + value
    return h(Box, { display: 'flex' },
        !urls ? 'error' : // check data is ok
        h(DisplayField, {
            label: "Link",
            value: link,
            error,
            end: h(Box, {},
                h(IconBtn, {
                    icon: ContentCopy,
                    title: "Copy",
                    onClick: () => navigator.clipboard.writeText(link)
                }),
                h(IconBtn, { icon: Edit, title: "Change", onClick() { changeBaseUrl().then(reload) } }),
            )
        }),
    )
}

export async function changeBaseUrl() {
    return new Promise(async resolve => {
        const res = await apiCall('get_status')
        const urls: string[] = res.urls.https || res.urls.http
        const { close } = newDialog({
            title: "Base address",
            Content() {
                const [v, setV] = useState(res.baseUrl || '')
                const proto = new URL(v || urls[0]).protocol + '//'
                const host = urls.includes(v) ? '' : v.slice(proto.length)
                const check = h(Check, { sx: { ml: 2 } })
                return h(Box, { display: 'flex', flexDirection: 'column' },
                    h(Box, { mb: 2 }, "Choose a base address for your links"),
                    h(MenuList, {},
                        h(MenuItem, {
                            selected: !v,
                            onClick: () => set(''),
                        }, "Automatic", !v && check),
                        urls.map(u => h(MenuItem, {
                            key: u,
                            selected: u === v,
                            onClick: () => set(u),
                        }, u, u === v && check))
                    ),
                    h(StringField, {
                        label: "Custom IP or domain",
                        helperText: md("You can type any address but *you* are responsible to make the address work.\nThis functionality is just to help you copy the link in case you have a domain or a complex network configuration."),
                        value: host,
                        onChange: v => set(prefix(proto, v)),
                        start: h(SelectField as Field<string>, {
                            value: proto,
                            onChange: v => host ? set(v + host) : toast("Enter domain first"),
                            options: ['http://','https://'],
                            size: 'small',
                            variant: 'standard',
                            sx: { '& .MuiSelect-select': { pt: '1px', pb: 0 } },
                        }),
                        sx: { mt: 2 }
                    }),
                    h(Box, { mt: 2, textAlign: 'right' },
                        h(Btn, {
                            icon: Save,
                            children: "Save",
                            async onClick() {
                                if (v !== res.baseUrl)
                                    await apiCall('set_config', { values: { base_url: v } })
                                resolve(v)
                                close()
                            },
                        }) ),
                )

                function set(u: string) {
                    if (u.endsWith('/'))
                        u = u.slice(0, -1)
                    setV(u)
                }
            }
        })
    })
}
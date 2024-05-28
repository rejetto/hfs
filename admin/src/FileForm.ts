// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, forwardRef, ReactElement, ReactNode, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Collapse, FormHelperText, Link, MenuItem, MenuList, useTheme } from '@mui/material'
import { BoolField, DisplayField, Field, FieldProps, Form, MultiSelectField, SelectField, StringField
} from '@hfs/mui-grid-form'
import { apiCall, UseApi } from './api'
import {
    basename, defaultPerms, formatBytes, formatTimestamp, isEqualLax, isWhoObject, newDialog, objSameKeys,
    onlyTruthy, prefix, VfsPerms, wantArray, Who, WhoObject, matches, HTTP_MESSAGES, xlate, md, Callback,
    useRequestRender, splitAt
} from './misc'
import { Btn, IconBtn, LinkBtn, modifiedProps, useBreakpoint, wikiLink } from './mui'
import { reloadVfs, VfsNode } from './VfsPage'
import _ from 'lodash'
import FileField from './FileField'
import { alertDialog, toast, useDialogBarColors } from './dialog'
import yaml from 'yaml'
import { Add, Check, ContentCopy, ContentCut, ContentPaste, Delete, Edit, QrCode2, Save } from '@mui/icons-material'
import { moveVfs } from './VfsTree'
import QrCreator from 'qr-creator';
import MenuButton from './MenuButton'
import addFiles, { addLink, addVirtual } from './addFiles'

const ACCEPT_LINK = "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/accept"

export interface Account { username: string }

interface FileFormProps {
    file: VfsNode
    addToBar?: ReactNode
    statusApi: UseApi
    accounts: Account[]
    saved: Callback
}
export default function FileForm({ file, addToBar, statusApi, accounts, saved }: FileFormProps) {
    const { parent, children, isRoot, byMasks, ...rest } = file
    const [values, setValues] = useState(rest)
    useEffect(() => {
        setValues(Object.assign(objSameKeys(defaultPerms, () => null), rest))
    }, [file]) //eslint-disable-line

    const inheritedDefault = useMemo(() => {
        let p = file.parent
        while (p) {
            if (p.default != null)
                return p.default
            p = p.parent
        }
    }, [file])
    const { source } = file
    const isDir = file.type === 'folder'
    const isUnknown = !file.type && source && file.size! < 0 // the type is lost
    const isLink = values.url !== undefined
    const hasSource = source !== undefined // we need a boolean
    const realFolder = hasSource && isDir
    const lg = useBreakpoint('lg')
    const showTimestamps = !isLink && (lg || hasSource)
    const showSize = !isLink && lg || (hasSource && !realFolder)
    const showAccept = file.accept! > '' || isDir && (file.can_upload ?? file.inherited?.can_upload)
    const showWebsite = isDir
    const barColors = useDialogBarColors()
    const { movingFile } = useSnapState()

    const needSourceWarning = !hasSource && h(Box, { color: 'warning.main', component: 'span' }, "Works only on folders with disk source! ")
    const show: Record<keyof VfsPerms, boolean> = {
        can_read: !isLink,
        can_see: true,
        can_archive: !isLink,
        can_list: isDir,
        can_upload: isDir,
        can_delete: isDir,
    }
    return h(Form, {
        values,
        set(v, k) {
            setValues(values => {
                const nameIsVirtual = k === 'source' && values.name && values.source?.endsWith(values.name)
                const name = nameIsVirtual ? basename(v) : values.name // update name if virtual
                return { ...values, name, [k]: v }
            })
        },
        barSx: { gap: 2, width: '100%', ...barColors },
        stickyBar: true,
        addToBar: [
            h(MenuButton, {
                variant: 'outlined',
                startIcon: h(Add),
                items: [
                    { children: "from disk", onClick: addFiles },
                    { children: "virtual folder", onClick: addVirtual },
                    { children: "web-link", onClick: addLink  },
                ]
            }, "Add"),
            h(IconBtn, {
                icon: ContentCut,
                disabled: isRoot || movingFile === file.id,
                title: "Cut (you can also use drag & drop to move items)",
                'aria-label': "Cut",
                onClick() {
                    state.movingFile = file.id
                    alertDialog(h(Box, {}, "Now that this is marked for moving, click on the destination folder, and then the paste button ", h(ContentPaste)), 'info')
                },
            }),
            movingFile && h(IconBtn, {
                icon: ContentPaste,
                disabled: file.type !== 'folder'
                    || file.id.startsWith(movingFile) // can't move below myself
                    || file.id === movingFile.replace(/[^/]+\/?$/,''), // can't move to the same parent
                title: movingFile,
                onClick() {
                    state.movingFile = ''
                    return moveVfs(movingFile, file.id)
                },
            }),
            h(IconBtn, {
                icon: Delete,
                title: "Delete",
                confirm: `Delete ${file.name}?`,
                disabled: isRoot,
                onClick: () => apiCall('del_vfs', { uris: [file.id] }).then(({ errors: [err] }) => {
                    if (err)
                        alertDialog(xlate(err, HTTP_MESSAGES), 'error')
                    else
                        reloadVfs([])
                }),
            }),
            ...wantArray(addToBar)
        ],
        onError: alertDialog,
        save: {
            ...modifiedProps(!isEqualLax(values, rest)),
            async onClick() {
                const props = _.omit(values, ['ctime','mtime','size','id'])
                ;(props as any).masks ||= null // undefined cannot be serialized
                await apiCall('set_vfs', { uri: values.id, props })
                if (props.name !== file.name) // when the name changes, the id of the selected file is changing too, and we have to update it in the state if we want it to be correctly re-selected after reload
                    state.selectedFiles[0].id = file.parent!.id + props.name + (isDir ? '/' : '')
                reloadVfs()
                saved()
            }
        },
        fields: [
            isRoot ? h(Alert, { severity: 'info' }, "This is Home, the root of your shared files. Options set here will be applied to all files.")
                : isDir && hasSource && h(Alert, { severity: 'info' }, `To set permissions on individual items in folder, add them by clicking Add button, and then "from disk"`),
            !isRoot && { k: 'name', required: true, xl: true, helperText: hasSource && "You can decide a name that's different from the one on your disk" },
            isLink ? { k: 'url', label: "URL", lg: 12, required: true }
                : { k: 'source', label: "Disk source", xl: true, comp: FileField, files: isUnknown || !isDir, folders: isUnknown || isDir,
                    placeholder: "none",
                    helperText: !values.source ? "This field is currently empty, and thus this element is a virtual-folder, no upload or delete is possible here."
                        : isDir ? "Content from this path on disk will be listed, but you can also add more" : undefined,
            },
            { k: 'id', comp: LinkField, statusApi, xs: 12 },
            perm('can_read', "Who can see but not download will be asked to login"),
            perm('can_see', "If you can't see, you may still download with a direct link"),
            perm('can_archive', "Should this be included when user downloads as ZIP", { lg: isDir ? true : 12 }),
            perm('can_list', undefined, { contentText: "subfolders" }),
            perm('can_delete', [needSourceWarning, "Those who can delete can also rename and cut/move"]),
            perm('can_upload', needSourceWarning, { contentText: "subfolders" }),
            isLink && {
                k: 'target',
                comp: BoolField,
                sm: true,
                label: "Open in new browser",
                fromField: x => x ? '_blank' : null,
                toField: x => x > '',
            },
            showSize && { k: 'size', comp: DisplayField, sm: 6, lg: 4, toField: formatBytes },
            showTimestamps && { k: 'ctime', comp: DisplayField, sm: 6, lg: showSize && 4, label: "Created", toField: formatTimestamp },
            showTimestamps && { k: 'mtime', comp: DisplayField, sm: 6, lg: showSize && 4, label: "Modified", toField: formatTimestamp },
            showAccept && { k: 'accept', label: "Accept on upload", placeholder: "anything", xl: showWebsite ? 4 : 12,
                helperText: h(Link, { href: ACCEPT_LINK, target: '_blank' }, "Example: .zip") },
            showWebsite && { k: 'default', comp: BoolField, xl: true,
                label: "Serve as website if index.html is found" + (inheritedDefault && values.default == null ? ' (inherited)' : ''),
                value: values.default ?? inheritedDefault,
                toField: Boolean, fromField: (v:boolean) => v && !inheritedDefault ? 'index.html' : v ? null : false,
                helperText: md("...instead of showing list of files")
            },
            isDir && { k: 'masks', multiline: true,
                toField: yaml.stringify, fromField: v => v ? yaml.parse(v) : undefined,
                sx: { '& textarea': { fontFamily: 'monospace' } },
                helperText: ["Special field, leave empty unless you know what you are doing. YAML syntax. ", wikiLink('Masks-field', "(examples)")]
            }
        ]
    })

    function perm(perm: keyof VfsPerms, helperText?: ReactNode, props: Partial<WhoFieldProps>={}) {
        if (!show[perm]) return null
        const dontShow = [perm, ...onlyTruthy(_.map(show, (v,k) => !v && k))]
        const others = _.difference(Object.keys(defaultPerms), dontShow)
        let inherit = file.inherited?.[perm] ?? defaultPerms[perm]
        if (typeof inherit === 'string' && _.get(show, inherit) === false) // is 'inherit' referring another permission that is not displayed?
            inherit = _.get(values, inherit) ?? _.get(defaultPerms, inherit)! // then show its value instead
        return {
            comp: WhoField,
            k: perm, sm: 6, xl: 4,
            parent, accounts, helperText, isDir,
            otherPerms: others.map(x => ({ value: x, label: who2desc(x) })),
            label: "Who can " + perm2word(perm),
            inherit,
            byMasks: byMasks?.[perm],
            fromField: (v?: Who) => v ?? null,
            ...props
        }
    }

}

function perm2word(perm: string) {
    return xlate(perm.split('_')[1], { read: 'download', archive: 'zip', list: 'access folder' })
}

interface WhoFieldProps extends FieldProps<Who | undefined> {
    accounts: Account[],
    otherPerms: any[],
    isChildren?: boolean,
    isDir: boolean
    contentText?: string
}
function WhoField({ value, onChange, parent, inherit, accounts, helperText, otherPerms, byMasks,
        hideValues, isChildren, isDir, contentText="folder content", setApi, ...rest }: WhoFieldProps): ReactElement {
    const defaultLabel = who2desc(byMasks ?? inherit)
        + prefix(' (', byMasks !== undefined ? "from masks" : parent !== undefined ? "inherited" : "default", ')')
    const objectMode =  isWhoObject(value)
    const thisValue = objectMode ? value.this : value

    const options = useMemo(() =>
        onlyTruthy([
            { value: null, label: defaultLabel },
            { value: true },
            { value: false },
            { value: '*' },
            ...otherPerms,
            { value: [], label: "Select accounts" },
        ].map(x => !hideValues?.includes(x.value)
            && { label: who2desc(x.value), ...x })), // default label
        [inherit, parent, thisValue])

    const timeout = 500
    const arrayMode = Array.isArray(thisValue)
    // a large side band will convey union across the fields
    return h(Box, { sx: { borderRight: objectMode ? '8px solid #8884' : undefined, transition: `all ${timeout}ms` } },
        h(SelectField as typeof SelectField<typeof thisValue | null>, {
            ...rest,
            value: arrayMode ? [] : thisValue ?? null,
            onChange(v, { event }) {
                onChange(objectMode ? simplify({ ...value, this: v ?? undefined }) : v ?? undefined, { was: value, event })
            },
            options,
        }),
        h(Collapse, { in: arrayMode, timeout },
            arrayMode && h(MultiSelectField as Field<string[]>, {
                label: accounts?.length ? "Accounts for " + rest.label : "You didn't create any account yet",
                value: thisValue,
                onChange,
                options: accounts?.map(a => ({ value: a.username, label: a.username })) || [],
            }) ),
        h(FormHelperText, {},
            helperText,
            !isChildren && isDir && h(LinkBtn, {
                sx: { display: 'block', mt: -.5 },
                onClick(event) {
                    onChange(objectMode ? thisValue : { this: thisValue, children: thisValue == null ? !inherit : undefined  } , { was: value, event })
                }
            }, objectMode ? "Set same permission for " : "Set different permission for ", contentText)
        ),
        !isChildren && h(Collapse, { in: objectMode, timeout },
            h(WhoField, {
                label: "Permission for " + contentText,
                parent, inherit, accounts, otherPerms, isDir,
                value: objectMode && value?.children,
                isChildren: true,
                hideValues: [thisValue ?? inherit, thisValue],
                onChange(v, { event }) {
                    if (objectMode) // shut up ts
                        onChange(simplify({ ...value, children: v }), { was: value, event })
                }
            })
        ),
    )

    function simplify(v: WhoObject) {
        return v.this === v.children ? v.this : v
    }
}

function who2desc(who: any) {
    return who === false ? "No one"
        : who === true ? "Anyone"
            : who === '*' ? "Any account (login required)"
                : Array.isArray(who) ? who.join(', ')
                    : typeof who === 'string' ? `As "can ${perm2word(who)}"`
                        : "*UNKNOWN*" + JSON.stringify(who)
}

interface LinkFieldProps extends FieldProps<string> {
    statusApi: UseApi<any> // receive status from parent, to avoid asking server at each click on a file
}
function LinkField({ value, statusApi }: LinkFieldProps) {
    const { reload, error } = statusApi
    // workaround to get fresh data and be rerendered even when mounted inside imperative dialog
    const requestRender = useRequestRender()
    useEffect(() => { statusApi.sub(requestRender) }, [])
    const data = statusApi.getData()

    const urls: string[] = data?.urls.https || data?.urls.http
    const baseHost = data?.baseUrl && new URL(data.baseUrl).host
    const root = useMemo(() => baseHost && _.find(data.roots, (root, host) => matches(baseHost, host)),
        [data])
    if (root)
        value &&= value.indexOf(root) === 1 ? value.slice(root.length) : undefined
    const link = prefix(data?.baseUrl || '', value)
    const RenderLink = useMemo(() => forwardRef((props: any, ref) =>
        h(Link, {
            ref,
            ...props,
            href: link,
            style: { height: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' },
            target: 'frontend',
        }, link)
    ), [link])
    return h(Box, { display: 'flex' },
        !urls ? 'error' : // check data is ok
        h(DisplayField, {
            label: "Link",
            value: link || `outside of configured main address (${baseHost})`,
            error,
            InputProps: link ? { inputComponent: RenderLink } : undefined,
            end: h(Box, {},
                h(IconBtn, {
                    icon: ContentCopy,
                    title: "Copy",
                    disabled: !link,
                    onClick: () => navigator.clipboard.writeText(link)
                }),
                h(IconBtn, { icon: QrCode2, title: "QR Code", onClick: showQr, disabled: !link }),
                h(IconBtn, { icon: Edit, title: "Change", onClick() { changeBaseUrl().then(reload) } }),
            )
        }),
    )

    function showQr() {
        newDialog({
            title: "QR Code",
            dialogProps: { sx: { bgcolor: 'background.default', border: '1px solid' } },
            Content() {
                const theme = useTheme()
                return h('canvas', {
                    ref: (canvas: HTMLCanvasElement) => canvas && generateQRCode(canvas, link, theme.palette.text.primary),
                    style: { width: '100%' },
                })
            }
        })
    }

    async function generateQRCode(canvas: HTMLCanvasElement, text: string, color: string) {
        try {
            QrCreator.render({
                text,
                radius: 0.0, // 0.0 to 0.5
                ecLevel: 'H', // L, M, Q, H
                fill: color, // foreground color
                background: null, // color or null for transparent
                size: 300 // in pixels
            }, canvas);
        } catch (error) {
            console.error('Error generating QR code:', error);
        }
    }
}

export async function changeBaseUrl() {
    return new Promise(async resolve => {
        const res = await apiCall('get_status')
        const { base_url, roots } = await apiCall('get_config', { only: ['base_url', 'roots'] })
        const urls: string[] = res.urls.https || res.urls.http
        const domainsFromRoots = Object.keys(roots).map(x => x.split('|')).flat().filter(x => !/[*?]/.test(x))
        const proto = splitAt('//', urls[0])[0] + '//'
        urls.push(...domainsFromRoots.map(x => proto + x))
        const { close } = newDialog({
            title: "Main address",
            Content() {
                const [v, setV] = useState(base_url || '')
                const proto = new URL(v || urls[0]).protocol + '//'
                const host = urls.includes(v) ? '' : v.slice(proto.length)
                const check = h(Check, { sx: { ml: 2 } })
                return h(Box, { display: 'flex', flexDirection: 'column' },
                    h(Box, { mb: 2 }, "Choose a main address for your links"),
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
                                if (v !== base_url)
                                    await apiCall('set_config', { values: { base_url: v.replace(/\/$/, '') } })
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

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getInheritedPerms, id2vfsNode, markVfsModified, prepareVfsUndo, reindexVfs, state, VfsNodeAdmin } from './state'
import { createElement as h, forwardRef, memo, ReactNode, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Link, useTheme } from '@mui/material'
import {
    BoolField, DisplayField, FieldProps, Form, NumberField, SelectField
} from '@hfs/mui-grid-form'
import { UseApi } from './api'
import {
    basename, defaultPerms, formatBytes, formatTimestamp, isModifiedConfig, newDialog, useRequestRender, try_, pathEncode,
    onlyTruthy, prefix, VfsPerms, wantArray, WhoVfs, matches, md, Callback, copyTextToClipboard,
    IMAGE_FILEMASK, MASK_IN_TESTS, WHO_ANY_ACCOUNT, WHO_ADMIN, enforceFinal, enforceStarting,
} from './misc'
import { Btn, Flex, IconBtn, propsForModifiedValues, useBreakpoint, wikiLink } from './mui'
import VfsActionButtons from './VfsActionButtons'
import _ from 'lodash'
import FileField from './FileField'
import { alertDialog, useDialogBarColors } from './dialog'
import yaml from 'yaml'
import { Check, ContentCopy, Edit, QrCode2, RestartAlt } from '@mui/icons-material'
import QrCreator from 'qr-creator'
import { AddVfsBtn } from './VfsMenuBar'
import { SYS_ICONS } from '@hfs/frontend/src/sysIcons'
import { TextEditorField } from './TextEditor'
import { type AccountsApi, perm2word, WhoField, type WhoFieldProps, who2desc } from './WhoField'
import { changeBaseUrl } from './baseUrl'

const ACCEPT_LINK = "https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/accept"

interface FileFormProps {
    file: VfsNodeAdmin
    addToBar?: ReactNode
    statusApi: UseApi
    accountsApi: AccountsApi
    done?: Callback
    isSideBreakpoint: boolean
}
export default function FileForm({ file, addToBar, statusApi, accountsApi, done, isSideBreakpoint }: FileFormProps) {
    const { parent, children, isRoot, byMasks, ...rest } = file
    const [values, setValues] = useState(rest)
    useEffect(() => {
        setValues(Object.assign(_.mapValues(defaultPerms, () => null), rest))
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
    const xl = useBreakpoint('xl')
    const showTimestamps = !isLink && (xl || hasSource)
    const showSize = !isLink && xl || (hasSource && !realFolder)
    const showAccept = file.accept! > '' || isDir && (file.can_upload ?? file.inherited?.can_upload)
    const showWebsite = isDir
    const autoApply = isSideBreakpoint
    const barColors = useDialogBarColors()
    const actions = [
        isDir && !isSideBreakpoint && h(AddVfsBtn, { variant: 'outlined' }, "Add"),
        !autoApply && h(VfsActionButtons, { files: [file], pasteTo: file, done }),
        ...wantArray(addToBar)
    ].filter(Boolean)

    const needSourceWarning = !hasSource && h(Box as any, { sx: { color: 'warning.main' }, component: 'span' }, "Works only on folders with disk source! ")
    const show: Record<keyof VfsPerms, boolean> = {
        can_read: !isLink,
        can_see: true,
        can_archive: !isLink,
        can_list: isDir,
        can_upload: isDir,
        can_delete: isDir,
    }
    const defaultIcon = !values.icon
    const embeddedIcon = values.icon && !values.icon.includes('.')
    const nameFromSource = source && basename(source)
    const nameIsDerivedFromSource = nameFromSource === values.name
    return h(Form, {
        values,
        set(v, k) {
            setFormValue(v, k as keyof typeof values | 'iconType')
        },
        onValidation: autoApply ? applyValidatedValues : undefined,
        onError: alertDialog,
        ...autoApply ? { save: false } : {
            barSx: { gap: 2, width: '100%', ...barColors },
            stickyBar: true,
            addToBar: actions,
            save: {
                ...propsForModifiedValues(isModifiedConfig(values, rest)),
                children: "Apply",
                startIcon: h(Check),
                async onClick() {
                    applyValues(values)
                    done?.()
                }
            },
        },
        fields: [
            isRoot ? h(Alert, { severity: 'info' }, "This is the Home folder, the root of your shared files. Options set here will be applied to all files.")
                : isDir && hasSource && h(Alert, { severity: 'info' }, `To set permissions on individual items in folder, add them by clicking Add button, and then "from disk"`),
            {
                k: 'name', required: true, xl: true, helperText: hasSource && "You can decide a name that's different from the one on your disk",
                ...isRoot && { disabled: true, value: "Home folder" },
                end: nameFromSource && !nameIsDerivedFromSource && h(Btn, {
                    icon: RestartAlt, title: "Reset to same name on disk",
                    onClick: resetNameFromSource
                }),
            },
            isLink ? { k: 'url', label: "URL", lg: 12, xl: 8, required: true }
                : { k: 'source', label: "Disk source", xl: true, comp: FileField, files: isUnknown || !isDir, folders: isUnknown || isDir,
                    placeholder: "none",
                    helperText: !values.source ? "If you enter a path here, its content will be listed. Leaving this empty, makes this folder fully virtual."
                        : isDir ? "Files from this path on disk will be listed, but you can add more" : undefined,
            },
            { k: 'id', comp: LinkField, statusApi, xs: 12 },
            { k: 'order', comp: NumberField, min: -1E5, max: 1E5, label: "Priority (order in the frontend)", placeholder: 'default', sm: 4, helperText: wikiLink('Virtual-file-system#order', "To force position") },
            {
                k: 'iconType',
                comp: SelectField,
                options: ['default', 'file', 'embedded'],
                value: !values.icon ? 'default' : embeddedIcon ? 'embedded' : 'file',
                xs: true,
                sm: defaultIcon ? 8 : true,
            },
            !defaultIcon && { k: 'icon', xs: 8, sm: 4,
                ...embeddedIcon ? {
                    comp: SelectField, // uniqBy to avoid same icon (with different names), but it works only on array, so first step is to convert the object
                    options: _.map(_.uniqBy(_.map(SYS_ICONS, (v,k) => [k, v[0], v[1] ?? k] as const), x => x[2]), ([k, emoji]) =>
                        ({ value: k, label: h(Flex, { gap: '.5em' }, hIcon(k), hIcon(emoji), ' ', k) }) ), // show both font-icon and emoji versions
                    helperText: "The second icon is the fallback"
                } : {
                    label: "Icon file", placeholder: "default", comp: FileField, fileMask: IMAGE_FILEMASK,
                }
            },
            perm('can_read', "Who can see but not download will be asked to log in"),
            perm('can_archive', "Should this be included when user downloads as ZIP"),
            perm('can_list', "Permission to request the list of a folder. The list will include only things you can see.", { contentText: "subfolders" }),
            perm('can_delete', [needSourceWarning, "Those who can delete can also rename and cut/move"]),
            perm('can_upload', needSourceWarning, { contentText: "subfolders" }),
            perm('can_see', ["See this item in the list. ", wikiLink('Permissions', "More help.")]),
            isLink && {
                k: 'target',
                comp: BoolField,
                sm: true,
                label: "Open in new browser",
                fromField: x => x ? '_blank' : null,
                toField: x => x > '',
            },
            showSize && { k: 'size', comp: DisplayField, sm: 6, lg: 4, toField: formatBytes },
            showTimestamps && { k: 'birthtime', comp: DisplayField, sm: 6, lg: showSize && 4, label: "Created", toField: formatTimestamp },
            showTimestamps && { k: 'mtime', comp: DisplayField, sm: 6, lg: showSize && 4, label: "Modified", toField: formatTimestamp },
            showAccept && { k: 'accept', label: "Accept on upload", placeholder: "anything", xl: showWebsite ? 4 : 12,
                helperText: h('span', {}, "Not enforced, just hinting the browser. ", h(Link, { href: ACCEPT_LINK, target: '_blank' }, "Example: .zip")) },
            showWebsite && { k: 'default', comp: BoolField, xl: showAccept ? 8 : 12,
                label: "Serve as web-page if index.html is found" + (inheritedDefault && values.default == null ? ' (inherited)' : ''),
                value: values.default ?? inheritedDefault,
                toField: Boolean, fromField: (v:boolean) => v && !inheritedDefault ? 'index.html' : v ? null : false,
                helperText: md("...instead of showing list of files")
            },
            { k: 'comment', multiline: true, xl: true },
            isDir && hasSource && { k: 'see_without_probing', comp: BoolField, xl: 6,
                label: "Show without probing disk source", helperText: "Don't access this folder's disk source when listing its parent" },
            isDir && { k: 'masks', multiline: true, xl: 6,
                toField: yaml.stringify, fromField: v => v ? yaml.parse(v) : undefined,
                comp: TextEditorField, lang: 'yaml',
                helperText: ["Special field, leave empty unless you know what you are doing. YAML syntax. ", wikiLink('Masks-field', "(examples)")]
            },
        ]
    })

    function perm(perm: keyof VfsPerms, helperText?: ReactNode, props: Partial<WhoFieldProps>={}) {
        if (!show[perm]) return null
        const dontShow = [perm, ...onlyTruthy(_.map(show, (v,k) => !v && k))]
        const others = _.difference(Object.keys(defaultPerms), dontShow)
        // a freshly created node can be selected before `inherited` is filled by a server roundtrip
        let inherit = file.inherited?.[perm] ?? getInheritedPerms(file)?.[perm] ?? defaultPerms[perm]
        while (typeof inherit === 'string' && _.get(show, inherit) === false) // is 'inherit' referring to another permission that is not displayed?
            inherit = _.get(values, inherit)
                // non-permission who values (like WHO_ANY_ACCOUNT) are not valid keys for inherited lookup
                ?? (inherit !== WHO_ANY_ACCOUNT && inherit !== WHO_ADMIN ? getInheritedPerms(file)?.[inherit] : undefined)
                ?? _.get(defaultPerms, inherit)! // then show its value instead
        return {
            comp: WhoField,
            k: perm, sm: 6, lg: 12, xl: 4,
            parent, accountsApi, helperText, isDir,
            otherPerms: others.map(x => ({ value: x, label: who2desc(x) })),
            label: "Who can " + perm2word(perm),
            inherit,
            byMasks: byMasks?.[perm],
            offerInheritance: true,
            fromField: (v?: WhoVfs) => v ?? null,
            ...props
        }
    }

    function setFormValue(v: any, k: keyof typeof values | 'iconType') {
        if (k === 'iconType') { // iconType is UI-only; store its change as icon so auto-apply sees a real VFS property
            k = 'icon'
            v = v === 'default' ? '' : v === 'file' ? 'select.a.file' : Object.keys(SYS_ICONS)[0]
        }
        const nextValues = { ...values, [k]: v }
        // updating the source, if the name is virtual, we must update that too
        if (k === 'source' && nameIsDerivedFromSource)
            nextValues.name = basename(v)
        setValues(nextValues)
        return nextValues
    }

    function resetNameFromSource() {
        const nextValues = setFormValue(nameFromSource, 'name')
        if (autoApply)
            applyValues(nextValues)
    }

    function applyValues(nextValues: typeof values) {
        const node = state.selectedFiles[0] || id2vfsNode.get(nextValues.id)
        if (!node)
            throw Error("Selected node not found")
        const props = _.omit(nextValues, ['birthtime','mtime','size','id'])
        if (!_.isEqual(nextValues, rest)) { // false is a meaningful permission, so lax config equality would discard "No one"
            prepareVfsUndo()
            Object.assign(node, props)
            if (props.name !== undefined)
                // changing the VFS name changes ids; refresh maps and selection before the UI reads stale references
                reindexVfs({ node, clearMap: false, select: [node] })
            markVfsModified()
        }
        if (node.id !== nextValues.id)
            // changing the name changes the readonly link field, so sync the local form copy too
            setValues({ ...nextValues, id: node.id })
    }

    function applyValidatedValues(errors: false | object) {
        if (errors) return
        // Form validates after the value update rerenders this component, so values is the validated snapshot
        applyValues(values)
    }

}

interface LinkFieldProps extends FieldProps<string> {
    statusApi: UseApi<any> // receive status from parent, to avoid asking server at each click on a file
}
function LinkField({ value, statusApi }: LinkFieldProps) {
    const { reload, error } = statusApi
    // workaround to get fresh data and be rerendered even when mounted inside imperative dialog
    const requestRender = useRequestRender()
    useEffect(() => statusApi.sub(requestRender), [])
    const data = statusApi.getData()

    const urls: string[] = data && (data.urls.https || data.urls.http || [data.base_url])
    const baseHost = try_(() => new URL(data?.baseUrl).host) // URL can throw on malformed data
    const roots = data?.roots || {}
    const root = baseHost && _.find(roots, (_root, host) => matches(baseHost, host))
    const originalValue = value
    if (root)
        value = pathInRoot(value, root)
    let linkBase = data?.baseUrl || ''
    if (value === undefined) { // baseUrl didn't match, but other hosts in roots may
        const base = try_(() => new URL(linkBase))
        if (base) {
            const sorted = _.sortBy(Object.entries(roots), ([, root]) => -String(root).length) // prioritize longer roots because are more specific
            for (const [hostMask, root] of sorted) {
                if (typeof root !== 'string') continue
                value = pathInRoot(originalValue, root)
                const host = value && hostMask.split('|').find(x => x && !/[*?]/.test(x) && x !== baseHost)
                if (!host) continue
                linkBase = base.protocol + '//' + host
                break
            }
        }
    }
    const link = prefix(linkBase, value)
    const RenderLink = useMemo(() => forwardRef((props: any, ref) =>
        h(Link, {
            ref,
            ...props,
            href: link,
            style: { height: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' },
            target: 'frontend',
        }, link)
    ), [link])
    return h(Box, { sx: { display: 'flex' } },
        !baseHost ? "Invalid baseUrl" : !urls ? 'error' : // check data is ok
        h(DisplayField, {
            label: "Link",
            className: MASK_IN_TESTS,
            value: link || `outside of configured main address (${baseHost})`,
            error,
            InputProps: link ? { inputComponent: RenderLink } : undefined,
            end: h(Box, {},
                h(IconBtn, {
                    icon: ContentCopy,
                    title: "Copy",
                    disabled: !link,
                    doneAnimation: true,
                    onClick: () => copyTextToClipboard(link)
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
            }, canvas)
        } catch (error) {
            console.error('Error generating QR code:', error)
        }
    }

    function pathInRoot(uri: string | undefined, root: string | undefined) {
        if (!root || root === '/') return uri
        // match the server's root normalization and preserve the directory boundary
        root = pathEncode(enforceFinal('/', enforceStarting('/', root.replace(/\/{2,}/g, '/'))))
        return uri?.startsWith(root) ? uri.slice(root.length - 1) : undefined
    }
}

interface IconProps { name:string, className?:string, alt?:string, [rest:string]: any }
// name = null ? none : unicode ? unicode : "?" ? file_url : font_icon_class
const Icon = memo(({ name, alt, className='', ...props }: IconProps) => {
    if (!name) return null
    const [emoji, clazz=name] = SYS_ICONS[name] || []
    className += ' icon'
    const nameIsTheIcon = name.length === 1 ||
        name.match(/^[\uD800-\uDFFF\u2600-\u27BF\u2B00-\u2BFF\u3030-\u303F\u3297\u3299\u00A9\u00AE\u200D\u20E3\uFE0F\u2190-\u21FF\u2300-\u23FF\u2400-\u243F\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF]*$/)
    const nameIsUrl = !nameIsTheIcon && /[/?]/.test(name)
    const isFontIcon = clazz
    className += nameIsUrl ? ' file-icon' : isFontIcon ? ` font-icon fa-${clazz}` : ' emoji-icon'
    return h('span',{
        ...alt ? { 'aria-label': alt } : { 'aria-hidden': true },
        role: 'img',
        ...props,
        ...nameIsUrl ? { style: { backgroundImage: `url(${JSON.stringify(name)})`, ...props?.style } } : undefined,
        className,
    }, nameIsTheIcon ? name : isFontIcon ? null : (emoji||'#'))
})

function hIcon(name: string, props?: Omit<IconProps, 'name'>) {
    return h(Icon, { name, ...props })
}

import { t, useI18N } from './i18n'
import {
    dontBotherWithKeys, formatBytes, getHFS, hfsEvent, hIcon, newDialog, prefix, with_, working,
    pathEncode, closeDialog
} from './misc'
import { createElement as h, Fragment, isValidElement, MouseEvent, ReactNode } from 'react'
import _ from 'lodash'
import { getEntryIcon, MISSING_PERM } from './BrowseFiles'
import { DirEntry, state } from './state'
import { deleteFiles } from './menu'
import { Link } from 'react-router-dom'
import { fileShow, getShowType } from './show'
import { alertDialog, promptDialog } from './dialog'
import { apiCall, useApi } from '@hfs/shared/api'
import { inputComment } from './upload'
import { cut } from './clip'

interface FileMenuEntry {
    id?: string
    label: ReactNode
    subLabel?: ReactNode
    href?: string
    icon?: string
    toggled?: boolean
    onClick?: (ev:MouseEvent<Element>) => any
}

export function openFileMenu(entry: DirEntry, ev: MouseEvent, addToMenu: (FileMenuEntry | 'open' | 'delete' | 'show')[]) {
    const { uri, isFolder, s } = entry
    const canRead = !entry.p?.includes('r')
    const canArchive = entry.p?.includes('A') || state.props?.can_archive && !entry.p?.includes('a')
    const cantDownload = entry.cantOpen || isFolder && !(canRead && canArchive) // folders needs list+read+archive
    const menu = [
        !cantDownload && { id: 'download', label: t`Download`, href: uri + (isFolder ? '?get=zip' : '?dl'), icon: 'download' },
        state.props?.can_comment && { id: 'comment', label: t`Comment`, icon: 'comment', onClick: () => editComment(entry) },
        ...addToMenu.map(x => {
            if (x === 'open') {
                if (entry.cantOpen) return
                const open = { id: 'open', icon: 'play', label: t('file_open', "Open"), href: uri, target: isFolder || entry.web ? undefined : '_blank' }
                return !isFolder ? open : h(Link, { to: uri, onClick: () => close() }, hIcon(open.icon), open.label)
            }
            if (x === 'delete')
                return (state.props?.can_delete || entry.p?.includes('d')) && {
                    id: 'delete',
                    label: t`Delete`,
                    icon: 'delete',
                    onClick: () => deleteFiles([entry.uri])
                }
            if (x === 'show')
                return !entry.cantOpen && getShowType(entry) && {
                    id: 'show',
                    label: t`Show`,
                    icon: 'image',
                    onClick: () => fileShow(entry)
                }
            return x
        }),
        state.props?.can_delete && { id: 'rename', label: t`Rename`, icon: 'edit', onClick: () => rename(entry) },
        state.props?.can_delete && { id: 'cut', label: t`Cut`, icon: 'cut', onClick: () => close(cut([entry])) },
        isFolder && !entry.web && { id: 'list', label: t`Get list`, href: uri + '?get=list&folders=*', icon: 'list' },
    ]
    const folder = entry.n.slice(0, -entry.name.length - 1)
    const props = [
        { id: 'name', label: t`Name`, value: entry.name },
        typeof s === 'number' && { id: 'size', label: t`Size`,
            value: h(Fragment, {}, formatBytes(s), h('small', {}, prefix(' (', s > 1024 && s.toLocaleString(), ')')) ) },
        entry.t && { id: 'timestamp', label: t`Timestamp`, value: entry.t.toLocaleString() },
        folder && {
            id: 'folder',
            label: t`Folder`,
            value: h(Link, {
                to: location.pathname + folder + '/',
                onClickCapture: () => closeDialog(null, true)
            }, folder.replaceAll('/', ' / '))
        },
    ]
    const res = hfsEvent('fileMenu', { entry, menu, props })
    if (res)
        menu.push(...res.flat())
    const ico = getEntryIcon(entry)
    const { close } = newDialog({
        title: isFolder ? t`Folder menu` : t`File menu`,
        className: 'file-dialog',
        icon: () => ico,
        position: Math.min(innerWidth, innerHeight) < 800 ? undefined
            : [ev.pageX, ev.pageY - scrollY] as [number, number],
        Content() {
            const {t} = useI18N()
            const details = useApi('get_file_details', { uris: [entry.uri] }).data?.details?.[0]
            const showProps = [ ...props,
                with_(details?.upload, x => x && { id: 'uploader', label: t`Uploader`, value: x.ip + prefix(' (', x.username, ')') })
            ]
            return h(Fragment, {},
                h('dl', { className: 'file-dialog-properties' },
                    dontBotherWithKeys(showProps.map(prop => isValidElement(prop) ? prop
                        : _.isPlainObject(prop) ? h('div', { id: `menu-prop-${prop.id}` }, h('dt', {}, prop.label), h('dd', {}, prop.value))
                            : null
                    ))
                ),
                entry.cantOpen && h(Fragment, {}, hIcon('password', { style: { marginRight: '.5em', marginTop: '.5em' } }), t(MISSING_PERM)),
                h('div', { className: 'file-menu' },
                    dontBotherWithKeys(menu.map((entry: FileMenuEntry, i) => // render menu entries
                        isValidElement(entry) ? entry
                            : entry?.label && h('a', {
                                key: i,
                                href: '#',
                                ..._.omit(entry, ['label', 'icon', 'toggled']),
                                id: entry.id && `menu-entry-${entry.id}`,
                                className: entry.toggled ? 'toggled' : undefined,
                                async onClick(ev: MouseEvent) {
                                    if (!entry.href)
                                        ev.preventDefault()
                                    if (false !== await entry.onClick?.(ev))
                                        close()
                                }
                            },
                                hIcon(entry.icon || 'file'),
                                h('label', { style: { display: 'flex', flexDirection: 'column' } },
                                    h('div', {}, entry.label),
                                    h('small', {}, entry.subLabel) )
                            )
                    ))
                )
            )
        }
    })
}

async function rename(entry: DirEntry) {
    const dest = await promptDialog(t`Name`, { def: entry.name, title: t`Rename` })
    if (!dest) return
    try {
        const { n, uri } = entry
        await apiCall('rename', { uri, dest }, { modal: working })
        const renamingCurrentFolder = uri === location.pathname
        if (!renamingCurrentFolder) {
            // update state instead of re-getting the list
            const newN = n.replace(/(.*?)[^/]+(\/?)$/, (_,before,after) => before + dest + after)
            const newEntry = new DirEntry(newN, { key: n, ...entry }) // by keeping old key, we avoid unmounting the element, that's causing focus lost
            const i = _.findIndex(state.list, { n })
            state.list[i] = newEntry
            // update filteredList too
            const j = _.findIndex(state.filteredList, { n })
            if (j >= 0)
                state.filteredList![j] = newEntry
        }
        alertDialog(t`Operation successful`).then(() => {
            if (renamingCurrentFolder)
                getHFS().navigate(uri + '../' + pathEncode(dest) + '/')
        })
    }
    catch(e: any) {
        await alertDialog(e)
    }
}

async function editComment(entry: DirEntry) {
    const res = await inputComment(entry.name, entry.comment)
    if (res === null) return
    await apiCall('comment', { uri: entry.uri, comment: res }, { modal: working })
    updateEntry(entry, e => e.comment = res)
    alertDialog(t`Operation successful`)
}

function updateEntry(entry: DirEntry, cb: (e: DirEntry) => unknown) {
    cb(_.find(state.list, { n: entry.n })!)
}
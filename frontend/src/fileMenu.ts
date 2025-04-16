import {
    dontBotherWithKeys, formatBytes, getHFS, hfsEvent, hIcon, newDialog, prefix, with_, working,
    pathEncode, closeDialog, anyDialogOpen, Falsy, operationSuccessful, randomId, err2msg, HIDE_IN_TESTS
} from './misc'
import { createElement as h, Fragment, isValidElement, MouseEvent, ReactNode, useState } from 'react'
import { Btn, Bytes, Spinner } from './components'
import _ from 'lodash'
import { getEntryIcon, MISSING_PERM } from './BrowseFiles'
import { DirEntry, state } from './state'
import { deleteFiles } from './menu'
import { Link, LinkProps } from 'react-router-dom'
import { fileShow, getShowComponent } from './show'
import { alertDialog, promptDialog, toast } from './dialog'
import { apiCall, useApi } from '@hfs/shared/api'
import { inputComment } from './upload'
import { cut } from './clip'
import { loginDialog } from './login'
import { useInterval } from 'usehooks-ts'
import i18n from './i18n'
const { t, useI18N } = i18n

interface FileMenuEntry {
    id?: string
    label: ReactNode
    subLabel?: ReactNode
    href?: string
    icon?: string
    toggled?: boolean
    onClick?: (ev:MouseEvent) => any
}

export async function openFileMenu(entry: DirEntry, ev: MouseEvent, addToMenu: (Falsy | FileMenuEntry | 'open' | 'delete' | 'show')[]) {
    const { uri, isFolder, s } = entry
    const canRead = !entry.p?.includes('r')
    const canList = !entry.p?.match(/L/i)
    const forbidden = entry.cantOpen === DirEntry.FORBIDDEN
    const cantDownload = forbidden || isFolder && !(canRead && entry.canArchive() && canList) // folders needs list+read+archive
    const menu = [
        !cantDownload && { id: 'download', label: t`Download`, href: uri + (isFolder ? '?get=zip' : '?dl'), icon: 'download' },
        state.props?.can_comment && { id: 'comment', label: t`Comment`, icon: 'comment', onClick: () => editComment(entry) },
        ...addToMenu.map(x => {
            if (x === 'open') {
                if (forbidden) return
                const open = {
                    id: 'open',
                    icon: 'play',
                    label: t('file_open', "Open"),
                    href: uri,
                    target: isFolder || entry.web ? undefined : '_blank',
                    onClick: makeOnClickOpen(entry)
                }
                return !isFolder || open.onClick ? open : h(LinkClosingDialog, { to: uri, reloadDocument: entry.web }, hIcon(open.icon), open.label)
            }
            if (x === 'delete')
                return entry.canDelete() && {
                    id: 'delete',
                    label: t`Delete`,
                    icon: 'delete',
                    onClick: () => deleteFiles([entry.uri])
                }
            if (x === 'show')
                return !entry.cantOpen && getShowComponent(entry) && {
                    id: 'show',
                    label: t`Show`,
                    icon: 'image',
                    onClick: () => fileShow(entry)
                }
            return x
        }),
        entry.canDelete() && { id: 'rename', label: t`Rename`, icon: 'edit', onClick: () => rename(entry) },
        entry.canDelete() && { id: 'cut', label: t`Cut`, icon: 'cut', onClick: () => close(cut([entry])) },
        isFolder && !entry.web && !entry.cantOpen && { id: 'list', label: t`Get list`, href: uri + '?get=list&folders=*', icon: 'list' },
    ].filter(Boolean)
    const folder = entry.n.slice(0, -1 - entry.name.length)
    const props = [
        { id: 'name', label: t`Name`, value: entry.name },
        typeof s === 'number' && { id: 'size', label: t`Size`,
            value: h(Fragment, {}, formatBytes(s), h('small', { className: HIDE_IN_TESTS }, prefix(' (', s > getHFS().kb && s.toLocaleString(), ')')) ) },
        entry.m && { id: 'timestamp', label: t`Timestamp`, value: entry.m.toLocaleString() },
        entry.c && { id: 'creation', label: t`Creation`, value: entry.c.toLocaleString() },
        folder && {
            id: 'folder',
            label: t`Folder`,
            value: h(Link, {
                to: (folder.startsWith('/') ? '' : location.pathname) + pathEncode(folder) + '/',
                onClick: () => closeDialog(null, true)
            }, folder.replaceAll('/', ' / '))
        },
        isFolder && !entry.cantOpen && { id: 'folderSize', label: t`Size`, value: h(FolderSize) },
    ].filter(Boolean)
    const res = await Promise.all(hfsEvent('fileMenu', { entry, menu, props }))
    menu.push(...res.flat()) // flat because each plugin may return an array of entries
    _.remove(menu, (x, i) => _.find(menu, y => x.id ? x.id === y.id : (!y.id && x.label === y.label), i + 1)) // avoid duplicates, keeping later ones
    const ico = getEntryIcon(entry)
    const { close } = newDialog({
        title: isFolder ? t`Folder menu` : t`File menu`,
        className: 'file-dialog',
        icon: () => ico,
        position: Math.min(innerWidth, innerHeight) < 800 ? undefined
            : [ev.pageX, ev.pageY - scrollY] as [number, number],
        restoreFocus: ev.screenY || ev.screenX ? false : undefined,
        Content() {
            const {t} = useI18N()
            const details = useApi('get_file_details', { uris: [entry.uri] }).data?.details?.[0]
            const showProps = [ ...props,
                with_(renderUploaderFromDetails(details), value =>
                    value && { id: 'uploader', label: t`Uploader`, value })
            ]
            return h(Fragment, {},
                h('dl', { className: 'file-dialog-properties' },
                    dontBotherWithKeys(showProps.map(prop => isValidElement(prop) ? prop
                        : _.isPlainObject(prop) ? h('div', { id: `menu-prop-${prop.id}` }, h('dt', {}, prop.label), h('dd', {}, prop.value))
                            : null
                    )),
                    entry.cantOpen && h('div', {}, hIcon('password', { style: { marginRight: '.5em', marginTop: '.5em' } }), t(MISSING_PERM)),
                ),
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
                                    try {
                                        if (false !== await entry.onClick?.(ev))
                                            close()
                                    }
                                    catch(e: any) {
                                        alertDialog(e)
                                    }
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

    function FolderSize() {
        const [go, setGo] = useState(false)
        const [id] = useState(() => randomId())
        const { data, error, loading } = useApi(go && 'get_folder_size', { uri: entry.uri, id }, { timeout: false })
        const partial = useApi(loading && 'get_folder_size_partial', { id })
        useInterval(partial.reload, 1000)
        return showRes(data || error)
            || (!loading ? h(Btn, { asText: true, label: t`Calculate`, onClick() { setGo(true) } })
                : h('span', {}, showRes(partial.data), ' ',
                    h(Btn, { asText: true, label: t`Cancel`, icon: h(Spinner), onClick() { setGo(false) } }) )
            )

        function showRes(data: any) {
            return data && (
                data.code ? err2msg(data)
                    : h('span', {}, h(Bytes, _.pick(data,'bytes')), ' / ', t('n_files', { n: data.files.toLocaleString() }, '{n,plural,one{# file} other{# files}}') )
            )
        }
    }
}

async function rename(entry: DirEntry) {
    const dest = await promptDialog(t`Name`, {
        value: entry.name,
        title: t`Rename`,
        onField: el => el.setSelectionRange(0, entry.name.lastIndexOf('.'))
    })
    if (!dest) return
    const { n, uri } = entry
    await apiCall('rename', { uri, dest }, { modal: working })
    const MSG = t`Operation successful`
    if (uri === location.pathname) //current folder
        return alertDialog(MSG)?.then(() =>
            getHFS().navigate(uri + '../' + pathEncode(dest) + '/') )
    // update state instead of re-getting the list
    const newN = n.replace(/(.*?)[^/]+$/, (_,before) => before + dest)
    const newEntry = new DirEntry(newN, { key: n, ...entry }) // by keeping old key, we avoid unmounting the element, that's causing focus lost
    const i = _.findIndex(state.list, { n })
    state.list[i] = newEntry
    // update filteredList too
    const j = _.findIndex(state.filteredList, { n })
    if (j >= 0)
        state.filteredList![j] = newEntry
    toast(MSG, 'success')
}

async function editComment(entry: DirEntry) {
    const res = await inputComment(entry.name, entry.comment)
    if (res === undefined) return
    await apiCall('comment', { uri: entry.uri, comment: res }, { modal: working })
    updateEntry(entry, e => e.comment = res)
    operationSuccessful()
}

function updateEntry(entry: DirEntry, cb: (e: DirEntry) => unknown) {
    cb(_.find(state.list, { n: entry.n })!)
}

export function LinkClosingDialog(props: LinkProps) {
    return h(Link, props.reloadDocument ? props : {
        ...props,
        to: '', // workaround to get dialogs and browser-history work correctly
        async onClick(ev) {
            ev.preventDefault()
            while (anyDialogOpen())
                await closeDialog()?.closed
            getHFS().navigate(props.to)
        }
    })
}

export function makeOnClickOpen(entry: DirEntry) {
    return !entry.cantOpen ? undefined : async (ev: any) => {
        ev.preventDefault()
        if (entry.cantOpen === DirEntry.FORBIDDEN)
            return alertDialog(t`Forbidden`, 'warning')
        if (!await loginDialog(true, false)) return
        if (entry.isFolder && !entry.web) // internal navigation
            return setTimeout(() => getHFS().navigate(entry.uri)) // couldn't find the reason why navigating sync is reverted back
        location.href = entry.uri
    }
}

function renderUploaderFromDetails(details: any) {
    if (!details) return
    const { upload: u } = details
    return u && `${u.username||''}${prefix('@', u.ip)}`
}
import { t, useI18N } from './i18n'
import { dontBotherWithKeys, formatBytes, hfsEvent, hIcon, newDialog, prefix, with_, working } from './misc'
import { createElement as h, Fragment, isValidElement, MouseEvent, ReactNode } from 'react'
import _ from 'lodash'
import { getEntryIcon, MISSING_PERM } from './BrowseFiles'
import { DirEntry, pathEncode, state } from './state'
import { deleteFiles } from './menu'
import { Link } from 'react-router-dom'
import { fileShow, getShowType } from './show'
import { alertDialog, promptDialog } from './dialog'
import { apiCall, useApi } from '@hfs/shared/api'
import { navigate } from './App'
import { inputComment } from './upload'
import { cut } from './clip'

interface FileMenuEntry {
    id?: string
    label: ReactNode
    subLabel?: ReactNode
    href?: string
    icon?: string
    onClick?: (ev:MouseEvent<Element>) => any
}

export function openFileMenu(entry: DirEntry, ev: MouseEvent, addToMenu: (FileMenuEntry | 'open' | 'delete' | 'show')[]) {
    const { uri, isFolder, s } = entry
    const cantDownload = entry.cantOpen || isFolder && entry.p?.includes('r') // folders needs both list and read
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
        isFolder && { id: 'list', label: t`Get list`, href: uri + '?get=list&folders=*', icon: 'list' },
    ]
    const props = [
        [t`Name`, entry.name],
        typeof s === 'number' && [t`Size`, h(Fragment, {},
            formatBytes(s), h('small', {}, prefix(' (', s > 1024 && s.toLocaleString(), ')')) ) ],
        entry.t && [t`Timestamp`, entry.t.toLocaleString()],
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
            const details = useApi('get_file_details', { uris: [entry.uri] }).data
            const showProps = [ ...props,
                with_(details?.[0]?.upload, x => x && [ t`Uploader`, x.ip + prefix(' (', x.username, ')') ])
            ]
            return h(Fragment, {},
                h('dl', { className: 'file-dialog-properties' },
                    dontBotherWithKeys(showProps.map(prop => isValidElement(prop) ? prop
                        : Array.isArray(prop) ? h(Fragment, {}, h('dt', {}, prop[0]), h('dd', {}, prop[1]))
                            : null
                    ))
                ),
                entry.cantOpen && h(Fragment, {}, hIcon('password', { style: { marginRight: '.5em' } }), t(MISSING_PERM)),
                h('div', { className: 'file-menu' },
                    dontBotherWithKeys(menu.map((e: FileMenuEntry, i) => // render menu entries
                        isValidElement(e) ? e
                            : e?.label && h('a', {
                                key: i,
                                href: '#',
                                ..._.omit(e, ['label', 'icon', 'onClick']),
                                async onClick(event: MouseEvent) {
                                    if (!e.href)
                                        event.preventDefault()
                                    if (false !== await e.onClick?.(event))
                                        close()
                                }
                            },
                                hIcon(e.icon || 'file'),
                                h('label', { style: { display: 'flex', flexDirection: 'column' } },
                                    h('div', {}, e.label),
                                    h('small', {}, e.subLabel) )
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
        const isCurrentFolder = uri === location.pathname
        if (!isCurrentFolder) {
            // update state instead of re-getting the list
            const newN = n.replace(/(.*?)[^/]+(\/?)$/, (_,before,after) => before + dest + after)
            const newEntry = new DirEntry(newN, entry)
            const i = _.findIndex(state.list, { n })
            state.list[i] = newEntry
            const j = _.findIndex(state.filteredList, { n })
            if (j >= 0)
                state.filteredList![j] = newEntry
        }
        alertDialog(t`Operation successful`).then(() => {
            if (isCurrentFolder)
                navigate(uri + '../' + pathEncode(dest) + '/')
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
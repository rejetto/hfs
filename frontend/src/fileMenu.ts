import { t, useI18N } from './i18n'
import { dontBotherWithKeys, formatBytes, hfsEvent, hIcon, newDialog, prefix, with_ } from './misc'
import { createElement as h, Fragment, isValidElement, MouseEventHandler, MouseEvent, ReactNode } from 'react'
import _ from 'lodash'
import { getEntryIcon, MISSING_PERM } from './BrowseFiles'
import { DirEntry, state } from './state'
import { deleteFiles } from './menu'
import { Link } from 'react-router-dom'
import { fileShow, getShowType } from './show'
import { alertDialog, promptDialog } from './dialog'
import { apiCall, useApi } from '@hfs/shared/api'

interface FileMenuEntry {
    label: ReactNode
    href?: string
    icon?: string
    onClick?: MouseEventHandler
}

export function openFileMenu(entry: DirEntry, ev: MouseEvent, addToMenu: (FileMenuEntry | 'open' | 'delete' | 'show')[]) {
    const { uri, isFolder, s } = entry
    const fullUri = uri[0] === '/' ? uri : location.pathname + uri
    const cantDownload = entry.cantOpen || isFolder && entry.p?.includes('r') // folders needs both list and read
    const menu = [
        !cantDownload && { label: t`Download`, href: uri + (isFolder ? '?get=zip' : '?dl'), icon: 'download' },
        ...addToMenu.map(x => {
            if (x === 'open') {
                if (entry.cantOpen) return
                const open = { icon: 'play', label: t('file_open', "Open"), href: uri, target: isFolder ? undefined : '_blank' }
                return !isFolder ? open : h(Link, { to: fullUri, onClick: () => close() }, hIcon(open.icon), open.label)
            }
            if (x === 'delete')
                return state.can_delete && {
                    label: t`Delete`,
                    icon: 'trash',
                    onClick: () => deleteFiles([entry.uri], entry.uri[0] === '/' ? '' : location.pathname)
                }
            if (x === 'show')
                return !entry.cantOpen && getShowType(entry) && {
                    label: t`Show`,
                    icon: 'image',
                    onClick: () => fileShow(entry)
                }
            return x
        }),
        state.can_delete && { label: t`Rename`, icon: 'edit', onClick: () => rename(entry) },
        isFolder && { label: t`Get list`, href: uri + '?get=list&folders=*', icon: 'list' },
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
    const close = newDialog({
        title: isFolder ? t`Folder menu` : t`File menu`,
        className: 'file-dialog',
        icon: () => ico,
        position: Math.min(innerWidth, innerHeight) < 800 ? undefined
            : [ev.pageX, ev.pageY - scrollY] as [number, number],
        Content() {
            const {t} = useI18N()
            const [details] = useApi('get_file_details', { uris: [fullUri] });
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
                    dontBotherWithKeys(menu.map((e: any, i) => // render menu entries
                        isValidElement(e) ? e
                            : !e?.label ? null :
                                h('a', {
                                    key: i,
                                    href: e.href || '#',
                                    ..._.omit(e, ['label', 'icon', 'href', 'onClick']),
                                    async onClick() {
                                        if ((await e.onClick?.()) !== false)
                                            close()
                                    }
                                }, hIcon(e.icon || 'file'), e.label )
                    ))
                )
            )
        }
    })
}

async function rename(entry: DirEntry) {
    const dest = await promptDialog(t`Name`, { def: entry.name, title: t`Rename` })
    if (!dest) return
    const uri = location.pathname + entry.uri
    try {
        await apiCall('rename', { uri, dest })
        // update state instead of re-getting the list
        const { n } = entry
        const newN = n.replace(/(.*?)[^/]+(\/?)$/, (_,before,after) => before + dest + after)
        const newEntry = new DirEntry(newN, entry)
        const i = _.findIndex(state.list, { n })
        state.list[i] = newEntry
        const j = _.findIndex(state.filteredList, { n })
        if (j >= 0)
            state.filteredList![j] = newEntry

        alertDialog(t`Operation successful`).then() // don't wait, so it appears after the file-menu closes
    }
    catch(e: any) {
        await alertDialog(e)
    }
}
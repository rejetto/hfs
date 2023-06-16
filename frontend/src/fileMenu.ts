import { t, useI18N } from './i18n'
import { dontBotherWithKeys, formatBytes, hfsEvent, hIcon, newDialog } from './misc'
import { createElement as h, Fragment, isValidElement, MouseEventHandler, ReactNode } from 'react'
import _ from 'lodash'
import { getEntryIcon, MISSING_PERM } from './BrowseFiles'
import { DirEntry, state } from './state'
import { deleteFiles } from './menu'
import { Link } from 'react-router-dom'
import { fileShow, getShowType } from './show'

interface FileMenuEntry {
    label: ReactNode
    href?: string
    icon?: string
    onClick?: MouseEventHandler
}

export function openFileMenu(entry: DirEntry, ev: MouseEvent, addToMenu: (FileMenuEntry | 'open' | 'delete' | 'show')[]) {
    const { uri, isFolder } = entry
    const cantDownload = entry.cantOpen || isFolder && entry.p?.includes('r') // folders needs both list and read
    const menu = [
        !cantDownload && { label: t`Download`, href: uri + (isFolder ? '?get=zip' : '?dl'), icon: 'download' },
        ...addToMenu.map(x => {
            if (x === 'open') {
                if (entry.cantOpen) return
                const open = { icon: 'play', label: t('file_open', "Open"), href: uri, target: isFolder ? undefined : '_blank' }
                return !isFolder ? open : h(Link, { to: location.pathname + uri, onClick: () => close() }, hIcon(open.icon), open.label)
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
        isFolder && { label: t`Get list`, href: uri + '?get=list&folders=*', icon: 'list' }
    ]
    const props = [
        [t`Name`, entry.name],
        typeof entry.s === 'number' && [t`Size`, formatBytes(entry.s)],
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
            return h(Fragment, {},
                h('dl', { className: 'file-dialog-properties' },
                    dontBotherWithKeys(props.map(prop => isValidElement(prop) ? prop
                        : Array.isArray(prop) ? h(Fragment, {}, h('dt', {}, prop[0]), h('dd', {}, prop[1]))
                            : null
                    ))
                ),
                entry.cantOpen && h(Fragment, {}, hIcon('password', { style: { marginRight: '.5em' } }), t(MISSING_PERM)),
                h('div', { className: 'file-menu' },
                    dontBotherWithKeys(menu.map((e: any, i) =>
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

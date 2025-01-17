// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, LinkProps } from 'react-router-dom'
import { createElement as h, Fragment, ReactElement } from 'react'
import { getPrefixUrl, hIcon } from './misc'
import { DirEntry, state, useSnapState } from './state'
import { usePath, reloadList } from './useFetchList'
import { openFileMenu } from './fileMenu'
import { createFolder } from './upload'
import i18n from './i18n'
const { useI18N } = i18n

export function Breadcrumbs() {
    const base = getPrefixUrl() + '/'
    const currentPath = usePath().slice(base.length,-1)
    const parent = base + currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    let prev = base
    const breadcrumbs = currentPath ? currentPath.split('/').map(x => [prev += x + '/', decodeURIComponent(x)]) : []
    const {t} = useI18N()
    return h(Fragment, {},
        h(Breadcrumb, { id: 'breadcrumb-parent', label: hIcon('parent', { alt: t`parent folder` }), path: parent }),
        h(Breadcrumb, { id: 'breadcrumb-home', label: hIcon('home', { alt: t`home` }), path: base, current: !currentPath }),
        breadcrumbs.map(([path,label], i) =>
            h(Breadcrumb, {
                key: path,
                path,
                label,
                ...i === breadcrumbs.length - 1 && {
                    current: true,
                    label: h(Fragment, {}, label, hIcon('menu', { style: { position: 'relative', top: 1, marginLeft: '.3em' } }))
                },
            }) )
    )
}

function Breadcrumb({ path, label, current, ...rest }: { current?: boolean, path: string, label?: string | ReactElement } & Omit<LinkProps,'to'>) {
    const PAD = '\u00A0\u00A0' // make small elements easier to tap. Don't use min-width 'cause it requires display-inline that breaks word-wrapping
    if (typeof label === 'string' && label.length < 3)
        label = PAD + label + PAD
    const {t} = useI18N()
    const { props } = useSnapState()
    const p = props?.can_archive ? '' : 'a'
    return h(Link, {
        className: 'breadcrumb',
        to: path || '/',
        ...rest,
        async onClick(ev) {
            if (!current) return
            ev.preventDefault()
            openFileMenu(new DirEntry(decodeURIComponent(path), { p }), ev, [
                props?.can_upload && {
                    id: 'create-folder',
                    label: t`Create folder`,
                    icon: 'folder',
                    onClick: createFolder,
                },
                {
                    id: 'reload',
                    label: t`Reload`,
                    icon: 'reload',
                    onClick() {
                        state.remoteSearch = undefined
                        state.stopSearch?.()
                        reloadList()
                    }
                }
            ])
        }
    }, label)
}


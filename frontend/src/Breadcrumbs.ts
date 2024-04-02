// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link } from 'react-router-dom'
import { createElement as h, Fragment, ReactElement } from 'react'
import { getPrefixUrl, hIcon } from './misc'
import { DirEntry, state, useSnapState } from './state'
import { usePath, reloadList } from './useFetchList'
import { useI18N } from './i18n'
import { openFileMenu } from './fileMenu'

export function Breadcrumbs() {
    const base = getPrefixUrl() + '/'
    const currentPath = usePath().slice(base.length,-1)
    const parent = base + currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    let prev = base
    const breadcrumbs = currentPath ? currentPath.split('/').map(x => [prev += x + '/', decodeURIComponent(x)]) : []
    const {t} = useI18N()
    return h(Fragment, {},
        h(Breadcrumb, { label: hIcon('parent', { alt: t`parent folder` }), path: parent }),
        h(Breadcrumb, { label: hIcon('home', { alt: t`home` }), path: base, current: !currentPath }),
        breadcrumbs.map(([path,label], i) =>
            h(Breadcrumb, {
                key: path,
                path,
                label,
                current: i === breadcrumbs.length - 1,
            }) )
    )
}

function Breadcrumb({ path, label, current, title }:{ current?: boolean, path: string, label?: string | ReactElement, title?: string }) {
    const PAD = '\u00A0\u00A0' // make small elements easier to tap. Don't use min-width 'cause it requires display-inline that breaks word-wrapping
    if (typeof label === 'string' && label.length < 3)
        label = PAD + label + PAD
    const {t} = useI18N()
    const { props } = useSnapState()
    const p = props?.can_archive ? '' : 'a'
    return h(Link, {
        className: 'breadcrumb',
        to: path || '/',
        title,
        async onClick(ev) {
            if (!current) return
            ev.preventDefault()
            openFileMenu(new DirEntry(decodeURIComponent(path), { p }), ev, [
                {
                    id: 'reload',
                    label: t`Reload`,
                    icon: 'reload',
                    onClick() {
                        state.remoteSearch = ''
                        state.stopSearch?.()
                        reloadList()
                    }
                }
            ])
        }
    }, label)
}


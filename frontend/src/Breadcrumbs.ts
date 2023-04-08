// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link } from 'react-router-dom'
import { createElement as h, Fragment, ReactElement } from 'react'
import { getPrefixUrl, hIcon } from './misc'
import { state } from './state'
import { usePath, reloadList } from './useFetchList'
import { useI18N } from './i18n'

export function Breadcrumbs() {
    const base = getPrefixUrl() + '/'
    const currentPath = usePath().slice(base.length,-1)
    const parent = base + currentPath.slice(0, currentPath.lastIndexOf('/') + 1)
    let prev = base
    const breadcrumbs = currentPath ? currentPath.split('/').map(x => [prev += x + '/', decodeURIComponent(x)]) : []
    const {t}  = useI18N()
    return h(Fragment, {},
        h(Breadcrumb, { label: hIcon('parent', { title: t`parent folder` }), path: parent }),
        h(Breadcrumb, { label: hIcon('home', { title: t`home` }), path: base, current: !currentPath }),
        breadcrumbs.map(([path,label]) =>
            h(Breadcrumb, {
                key: path,
                path,
                label,
                current: path.slice(1,-1) === currentPath,
            }) )
    )
}

function Breadcrumb({ path, label, current }:{ current?: boolean, path?: string, label?: string | ReactElement }) {
    const PAD = '\u00A0\u00A0' // make small elements easier to tap. Don't use min-width 'cause it requires display-inline that breaks word-wrapping
    if (typeof label === 'string' && label.length < 3)
        label = PAD+label+PAD
    return h(Link, {
        className: 'breadcrumb',
        to: path || '/',
        async onClick() {
            if (current) {
                state.remoteSearch = ''
                state.stopSearch?.()
                reloadList()
            }
        }
    }, label)
}


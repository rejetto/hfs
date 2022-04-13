// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useLocation } from 'react-router-dom'
import { createElement as h, Fragment, ReactElement } from 'react'
import { confirmDialog } from './dialog'
import { hIcon } from './misc'
import { state } from './state'
import { reloadList } from './useFetchList'

export function Breadcrumbs() {
    const currentPath = useLocation().pathname.slice(1,-1)
    let prev = ''
    const parent = currentPath.split('/').slice(0,-1).join('/')+'/'
    const breadcrumbs = currentPath ? currentPath.split('/').map(x => [prev = prev + x + '/', decodeURIComponent(x)]) : []
    return h(Fragment, {},
        h(Breadcrumb, { label: hIcon('parent', { alt:'parent folder' }), path: parent }),
        h(Breadcrumb, { current: !currentPath, label: hIcon('home', { alt:'home' }) }),
        breadcrumbs.map(([path,label]) =>
            h(Breadcrumb, {
                key: path,
                path,
                label,
                current: path === currentPath+'/',
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


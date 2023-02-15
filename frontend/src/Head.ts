// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo } from 'react'
import { formatBytes, hIcon, prefix } from './misc'
import { Spinner, useCustomCode } from './components'
import { useSnapState } from './state'
import { MenuPanel } from './menu'
import { Breadcrumbs } from './Breadcrumbs'
import { FilterBar } from './FilterBar'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        useCustomCode('afterMenuBar'),
        h(Breadcrumbs),
        h(FolderStats),
        h(FilterBar),
    )
}

function FolderStats() {
    const { list, loading, stoppedSearch } = useSnapState()
    const stats = useMemo(() =>{
        let files = 0, folders = 0, size = 0
        for (const x of list) {
            if (x.isFolder)
                ++folders
            else
                ++files
            size += x.s||0
        }
        return { files, folders, size }
    }, [list])
    return h(Fragment, {},
        h('div', { id:'folder-stats' },
            stoppedSearch ? hIcon('interrupted', { title:'Search was interrupted' })
                : list.length>0 && loading && h(Spinner),
            [
                prefix('', stats.files,' file(s)'),
                prefix('', stats.folders, ' folder(s)'),
                stats.size ? formatBytes(stats.size) : '',
            ].filter(Boolean).join(', '),
        ),
        h('div', { style:{ clear:'both' }}),
    )
}

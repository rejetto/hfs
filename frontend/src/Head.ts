// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useMemo} from 'react'
import { formatBytes, hIcon, prefix } from './misc'
import { Spinner } from './components'
import { useSnapState } from './state'
import { MenuPanel } from './menu'
import { Breadcrumbs } from './Breadcrumbs'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        h(Breadcrumbs),
        h(FolderStats),
        h('div', { style:{ clear:'both' }}),
    )
}

function FolderStats() {
    const { list, loading, filteredList, selected, stoppedSearch } = useSnapState()
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
    const sel = Object.keys(selected).length
    const fil = filteredList?.length
    return h('div', { id:'folder-stats' },
        stoppedSearch ? hIcon('interrupted', { title:'Search was interrupted' })
            : list.length>0 && loading && h(Spinner),
        [
            prefix('', stats.files,' file(s)'),
            prefix('', stats.folders, ' folder(s)'),
            stats.size ? formatBytes(stats.size) : '',
            sel && sel+' selected',
            fil !== undefined && fil < list.length && fil+' displayed',
        ].filter(Boolean).join(', ')
    )
}

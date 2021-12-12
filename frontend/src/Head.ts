import { createElement as h, Fragment, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DirList } from './BrowseFiles'
import { formatBytes, hIcon, prefix } from './misc'

export function Head({ list }:{ list:DirList }) {
    return h(Fragment, {},
        h(MenuPanel),
        h(Breadcrumbs),
        h(FolderStats, { list })
    )
}

function MenuPanel() {
    return null
}

function FolderStats({ list }:{ list:DirList }) {
    const stats = useMemo(() =>{
        let files = 0, folders = 0, size = 0
        for (const x of list) {
            if (x.n.endsWith('/'))
                ++folders
            else
                ++files
            size += x.s||0
        }
        return { files, folders, size }
    }, [list])
    return h('div', { id:'folder-stats' },
        [
            prefix('', stats.files,' file(s)'),
            prefix('', stats.folders, ' folder(s)'),
            formatBytes(stats.size),
        ].filter(Boolean).join(', ')
    )
}

function Breadcrumbs() {
    const path = useLocation().pathname.slice(1,-1)
    let prev = ''
    const breadcrumbs = path ? path.split('/').map(x => [prev = prev + x + '/', x]) : []
    return h('div', { id: 'folder-path' },
        h(Breadcrumb),
        breadcrumbs.map(([path,label]) => h(Breadcrumb, { key: path, path, label }))
    )
}

function Breadcrumb({ path, label }:{ path?: string, label?: string }) {
    return h(Link, { to:path||'/' },
        h('button', {},
            label || hIcon('home')) )
}


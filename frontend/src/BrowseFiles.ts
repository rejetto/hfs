import { Link, useLocation } from 'react-router-dom'
import { useApi } from './api'
import { createElement as h, Fragment } from 'react'
import { formatBytes, hError, hIcon, Loading } from './misc'
import { Head } from './Head'

function usePath() {
    return decodeURI(useLocation().pathname)
}

export function BrowseFiles() {
    const path = usePath()
    let res = useApi('file_list', { path })
    if (!res)
        return h(Loading)
    if (res instanceof Error)
        return hError(res)
    const { list } = res
    return h(Fragment, {},
        h(Head, { list }),
        h(FilesList, { list }))
}

interface DirEntry { n:string, s?:number, m?:string, c?:string }
export type DirList = DirEntry[]

function FilesList({ list }:{ list:DirList }) {
    return h('ul', { className: 'dir' },
        !list.length ? 'Nothing here'
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, ...entry })))
}

function File({ n, m, c, s }: DirEntry) {
    const base = usePath()
    const isDir = n.endsWith('/')
    const t = m||c ||null
    return h('li', {},
        isDir ? h(Link, { to: base+n }, hIcon('folder'), n)
            : h('a', { href: n }, hIcon('file'), n),
        h('div', { className:'entry-props' },
            s !== undefined && h(Fragment, {},
                h('span', { className:'entry-size' }, formatBytes(s)),
                hIcon('download'),
            ),
            t && h('span', { className:'entry-ts' }, new Date(t).toLocaleString()),
        ),
        h('div', { style:{ clear:'both' } })
    )
}


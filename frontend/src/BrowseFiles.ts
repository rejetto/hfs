import { Link, useLocation } from 'react-router-dom'
import { useApi } from './api'
import { createContext, createElement as h, Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { formatBytes, hError, hIcon } from './misc'
import { Loading, Spinner } from './components'
import { Head } from './Head'

function usePath() {
    return decodeURI(useLocation().pathname)
}

export const ListContext = createContext<{ list:DirList, unfinished:boolean }>({ list:[], unfinished: false })

export function BrowseFiles() {
    const [list, unfinished] = useFetchList()
    if (!list)
        return h(Loading)
    if (list instanceof Error)
        return hError(list)
    return h(ListContext.Provider, { value:{ list, unfinished } },
        h(Head),
        h(FilesList))
}

function useFetchList() {
    const desiredPath = usePath()
    const PRELOAD_SIZE = 100
    const [preloading, setPreloading] = useState(true)
    const [path, setPath] = useState('')
    useEffect(()=>{
        setPreloading(true)
        setPath(desiredPath)
    }, [desiredPath])
    const API = 'file_list'
    const preload = useApi(path && API, { path, limit: PRELOAD_SIZE })
    const rest = useApi(!preloading && API, { path, offset: PRELOAD_SIZE })
    const list = useMemo(() => !preload ? null
            : !rest ? (preload.list||preload) // the || is for an Error instance
            : [...preload.list, ...rest.list],
        [preload, rest])
    const unfinished = preload && !rest && list.length === PRELOAD_SIZE
    if (unfinished && preloading) // let load it all
        setPreloading(false)
    return [ list, unfinished ]
}

interface DirEntry { n:string, s?:number, m?:string, c?:string }
export type DirList = DirEntry[]

function FilesList() {
    const { list, unfinished } = useContext(ListContext)
    return h('ul', { className: 'dir' },
        !list.length ? 'Nothing here'
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, ...entry })),
        unfinished && h(Spinner))
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


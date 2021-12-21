import { Link, useLocation } from 'react-router-dom'
import { useApi } from './api'
import { createContext, createElement as h, Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { formatBytes, hError, hIcon } from './misc'
import { Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import _ from 'lodash'

function usePath() {
    return decodeURI(useLocation().pathname)
}

export const ListContext = createContext<{ list:DirList, unfinished:boolean }>({ list:[], unfinished: false })

export function BrowseFiles() {
    const [list, unfinished] = useFetchList()
    if (!list)
        return h(Spinner)
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
        const loc = window.location
        if (!desiredPath.endsWith('/')) // useful only in dev, while accessing the frontend directly without passing by the main server
            loc.href = loc.href+'/'
        state.remoteSearch = ''
        setPreloading(true)
        setPath(desiredPath)
    }, [desiredPath])
    const API = 'file_list'
    const snap = useSnapState()
    const search = snap.remoteSearch
    const preload = useApi(path && API, { path, search, limit: PRELOAD_SIZE })
    const rest = useApi(!preloading && API, { path, search, offset: PRELOAD_SIZE })
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
    const snap = useSnapState()
    const filter = snap.listFilter > '' && new RegExp(_.escapeRegExp(snap.listFilter),'i')
    let n = 0 // if I try to use directly the state as counter I get a "too many re-renders" error
    const ret = h('ul', { className: 'dir' },
        !list.length ? 'Nothing here'
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, hidden: filter && !filter.test(entry.n) || !++n, ...entry })),
        unfinished && h(Spinner))
    state.filteredEntries = filter ? n : -1
    return ret
}

function File({ n, m, c, s, hidden }: DirEntry & { hidden:boolean }) {
    const base = usePath()
    const isDir = n.endsWith('/')
    const t = m||c ||null
    const href = n.replace(/#/g, encodeURIComponent)
    return h('li', { style:hidden ? { display:'none' } : null },
        isDir ? h(Link, { to: base+href }, hIcon('folder'), n)
            : h('a', { href }, hIcon('file'), n),
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


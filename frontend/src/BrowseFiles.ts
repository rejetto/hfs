import { Link, useLocation } from 'react-router-dom'
import { createContext, createElement as h, Fragment, useContext } from 'react'
import { formatBytes, hError, hIcon } from './misc'
import { Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import _ from 'lodash'
import useFetchList from './useFetchList'

export function usePath() {
    return decodeURI(useLocation().pathname)
}

export interface DirEntry { n:string, s?:number, m?:string, c?:string,
    ext:string, isFolder:boolean, t:Date } // we memoize these value for speed
export type DirList = DirEntry[]
interface ListRes { list:DirList, loading?:boolean, err?:Error, reload?:()=>void }

export const ListContext = createContext<ListRes>({ list:[], loading: false })

export function BrowseFiles() {
    const { list, loading, error, reload } = useFetchList()
    return h(ListContext.Provider, { value:{ list, loading, reload } },
        h(Head),
        hError(error && 'Failed to retrieve list') || h(list ? FilesList : Spinner))
}

function FilesList() {
    const { list, loading } = useContext(ListContext)
    const snap = useSnapState()
    if (!list) return null
    const filter = snap.listFilter > '' && new RegExp(_.escapeRegExp(snap.listFilter),'i')
    let n = 0 // if I try to use directly the state as counter I get a "too many re-renders" error
    const ret = h('ul', { className: 'dir' },
        !list.length ? (!loading && 'Nothing here')
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, hidden: filter && !filter.test(entry.n) || !++n, ...entry })),
        loading && h(Spinner))
    state.filteredEntries = filter ? n : -1
    return ret
}

function File({ n, t, s, hidden, isFolder }: DirEntry & { hidden:boolean }) {
    const base = usePath()
    const containerDir = isFolder ? '' : n.substring(0, n.lastIndexOf('/')+1)
    if (containerDir)
        n = n.substring(containerDir.length)
    const href = fix(containerDir + n)
    return h('li', { className:isFolder ? 'folder' : 'file', style:hidden ? { display:'none' } : null },
        isFolder ? h(Link, { to: base+href }, hIcon('folder'), n)
            : h(Fragment, {},
                containerDir && h(Link, { to: base+fix(containerDir), className:'container-folder' }, hIcon('file'), containerDir ),
                h('a', { href }, !containerDir && hIcon('file'),  n)
            ),
        h('div', { className:'entry-props' },
            s !== undefined && h(Fragment, {},
                h('span', { className:'entry-size' }, formatBytes(s)),
                hIcon('download'),
            ),
            t && h('span', { className:'entry-ts' }, t.toLocaleString()),
        ),
        h('div', { style:{ clear:'both' } })
    )
}

function fix(s:string) {
    return s.replace(/#/g, encodeURIComponent)
}

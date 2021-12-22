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

interface DirEntry { n:string, s?:number, m?:string, c?:string }
export type DirList = DirEntry[]
interface ListRes { list:DirList, unfinished?:boolean, err?:Error }

export const ListContext = createContext<ListRes>({ list:[], unfinished: false })

export function BrowseFiles() {
    const { list, unfinished, error } = useFetchList()
    if (error)
        return hError(error)
    if (!list)
        return h(Spinner)
    return h(ListContext.Provider, { value:{ list, unfinished } },
        h(Head),
        h(FilesList))
}

function FilesList() {
    const { list, unfinished } = useContext(ListContext)
    const snap = useSnapState()
    if (!list) return null
    const filter = snap.listFilter > '' && new RegExp(_.escapeRegExp(snap.listFilter),'i')
    let n = 0 // if I try to use directly the state as counter I get a "too many re-renders" error
    const ret = h('ul', { className: 'dir' },
        !list.length ? (unfinished || 'Nothing here')
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

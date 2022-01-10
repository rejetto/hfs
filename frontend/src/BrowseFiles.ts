import { Link, useLocation } from 'react-router-dom'
import { createContext, createElement as h, Fragment, useContext, useEffect } from 'react'
import { formatBytes, hError, hIcon, useForceUpdate } from './misc'
import { Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import _ from 'lodash'
import useFetchList from './useFetchList'
import { alertDialog } from './dialog'

export function usePath() {
    return decodeURI(useLocation().pathname)
}

export interface DirEntry { n:string, s?:number, m?:string, c?:string,
    ext:string, isFolder:boolean, t?:Date } // we memoize these value for speed
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
    const midnight = useMidnight() // as an optimization we calculate this only once per list
    if (!list) return null
    const filter = snap.listFilter > '' && new RegExp(_.escapeRegExp(snap.listFilter),'i')
    let n = 0 // if I try to use directly the state as counter I get a "too many re-renders" error
    const ret = h('ul', { className: 'dir' },
        !list.length ? (!loading && (snap.stoppedSearch ? 'Stopped before finding anything' : 'Nothing here'))
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, midnight, hidden: filter && !filter.test(entry.n) || !++n, ...entry })),
        loading && h(Spinner))
    state.filteredEntries = filter ? n : -1
    return ret
}

function useMidnight() {
    const midnight = new Date()
    midnight.setHours(0,0,0,0)
    const [forceUpdate] = useForceUpdate()
    useEffect(()=>{
        const nextMidnight = new Date(midnight) // as an optimization we calculate this only once per list
        nextMidnight.setDate( 1 + nextMidnight.getDate() )
        setTimeout(forceUpdate, +nextMidnight - +midnight)
    },[])
    return midnight
}

function isMobile() {
    return window.innerWidth < 800
}

function File({ n, t, s, hidden, isFolder, midnight }: DirEntry & { hidden:boolean, midnight: Date }) {
    const base = usePath()
    const containerDir = isFolder ? '' : n.substring(0, n.lastIndexOf('/')+1)
    if (containerDir)
        n = n.substring(containerDir.length)
    const href = fix(containerDir + n)
    const today = t && t > midnight
    const shortTs = isMobile()
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
            t && h('span', {
                className: 'entry-ts',
                title: today || !shortTs ? null : t.toLocaleString(),
                onClick() { // mobile has no hover
                    if (shortTs)
                        alertDialog('Full timestamp:\n' + t.toLocaleString()).then()
                }
            }, !shortTs ? t.toLocaleString() : today ? t.toLocaleTimeString() : t.toLocaleDateString()),
        ),
        h('div', { style:{ clear:'both' } })
    )
}

function fix(s:string) {
    return s.replace(/#/g, encodeURIComponent)
}

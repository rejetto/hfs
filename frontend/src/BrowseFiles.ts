import { Link, useLocation } from 'react-router-dom'
import { createContext, createElement as h, Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { formatBytes, hError, hIcon, Html, hfsEvent } from './misc'
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
                h(Entry, { key: entry.n, midnight, hidden: filter && !filter.test(entry.n) || !++n, ...entry })),
        loading && h(Spinner))
    state.filteredEntries = filter ? n : -1
    return ret
}

function useMidnight() {
    const [midnight, setMidnight] = useState(calcMidnight)
    useEffect(() => {
        setTimeout(()=> setMidnight(calcMidnight()), 10 * 60_000) // refresh every 10 minutes
    }, [])
    return midnight

    function calcMidnight() {
        const recent = new Date()
        recent.setHours(recent.getHours() - 6)
        const midnight = new Date()
        midnight.setHours(0,0,0,0)
        return recent < midnight ? recent : midnight
    }
}

function isMobile() {
    return window.innerWidth < 800
}

function Entry(entry: DirEntry & { hidden:boolean, midnight: Date }) {
    let { n, hidden, isFolder } = entry
    const base = usePath()
    const href = fixUrl(n)
    const containerDir = isFolder ? '' : n.substring(0, n.lastIndexOf('/')+1)
    if (containerDir)
        n = n.substring(containerDir.length)
    return h('li', { className:isFolder ? 'folder' : 'file', style:hidden ? { display:'none' } : null },
        isFolder ? h(Link, { to: base+href }, hIcon('folder'), n)
            : h(Fragment, {},
                containerDir && h(Link, { to: base+fixUrl(containerDir), className:'container-folder' }, hIcon('file'), containerDir ),
                h('a', { href }, !containerDir && hIcon('file'),  n)
            ),
        h(EntryProps, entry),
        h('div', { style:{ clear:'both' } })
    )
}

function fixUrl(s:string) {
    return s.replace(/#/g, encodeURIComponent)
}

function EntryProps(entry: DirEntry & { midnight: Date }) {
    const { t, s } = entry
    const today = t && t > entry.midnight
    const shortTs = isMobile()
    const code = useMemo(()=> hfsEvent('additionalEntryProps', { entry }).join(''),
        [entry])
    return h('div', { className:'entry-props' },
        h(Html, { code, className:'add-props' }),
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
    )
}

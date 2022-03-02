// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useLocation } from 'react-router-dom'
import { createElement as h, Fragment, memo, useEffect, useMemo, useState } from 'react'
import { formatBytes, hError, hfsEvent, hIcon } from './misc'
import { Checkbox, Html, Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList from './useFetchList'

export function usePath() {
    return decodeURI(useLocation().pathname)
}

export interface DirEntry { n:string, s?:number, m?:string, c?:string,
    ext:string, isFolder:boolean, t?:Date } // we memoize these value for speed
export type DirList = DirEntry[]

export function BrowseFiles() {
    useFetchList()
    const { error, list } = useSnapState()
    return h(Fragment, {},
        h(Head),
        hError(error && 'Failed to retrieve list')
        || h(list ? FilesList : Spinner))
}

function FilesList() {
    const { filteredList, list, loading, stoppedSearch } = useSnapState()
    const midnight = useMidnight() // as an optimization we calculate this only once per list and pass it down
    const pageSize = 100
    const [page, setPage] = useState(0)
    const offset = page * pageSize
    const theList = filteredList || list
    const total = theList.length

    useEffect(() => setPage(0), [theList])
    useEffect(() => document.scrollingElement?.scrollTo(0,0), [page])

    return h(Fragment, {},
        h('ul', { className: 'dir' },
            !list.length ? (!loading && (stoppedSearch ? 'Stopped before finding anything' : 'Nothing here'))
                : filteredList && !filteredList.length ? 'No match for this filter'
                    : theList.slice(offset, offset + pageSize).map((entry: DirEntry) =>
                        h(Entry, { key: entry.n, midnight, ...entry })),
            loading && h(Spinner),
        ),
        total > pageSize && h(Paging, { total, current:page, pageSize, pageChange:setPage })
    )
}

interface PagingProps {
    total: number
    current: number
    pageSize: number
    pageChange:(newPage:number) => void
}
function Paging({ total, current, pageSize, pageChange }: PagingProps) {
    const nPages = Math.ceil(total / pageSize)
    const pages = []
    for (let i=0; i<nPages; i++)
        pages.push(h('button', {
            ...i===current && { className:'toggled' },
            onClick(){
                pageChange(i)
            }
        }, i*pageSize || 1))
    return h('div', { id:'paging' }, ...pages)
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

const Entry = memo(function(entry: DirEntry & { midnight: Date }) {
    let { n: relativePath, isFolder } = entry
    const base = usePath()
    const { showFilter, selected } = useSnapState()
    const href = fixUrl(relativePath)
    const containerDir = isFolder ? '' : relativePath.substring(0, relativePath.lastIndexOf('/')+1)
    const name = relativePath.substring(containerDir.length)
    return h('li', { className: isFolder ? 'folder' : 'file' },
        showFilter && h(Checkbox, {
            value: selected[relativePath],
            onChange(v){
                if (v)
                    return state.selected[relativePath] = true
                delete state.selected[relativePath]
            },
        }),
        isFolder ? h(Link, { to: base+href }, hIcon('folder'), relativePath)
            : h(Fragment, {},
                containerDir && h(Link, { to: base+fixUrl(containerDir), className:'container-folder' }, hIcon('file'), containerDir ),
                h('a', { href }, !containerDir && hIcon('file'),  name)
            ),
        h(EntryProps, entry),
        h('div', { style:{ clear:'both' } })
    )
})

function fixUrl(s:string) {
    return s.replace(/#/g, encodeURIComponent)
}

const EntryProps = memo(function(entry: DirEntry & { midnight: Date }) {
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
})

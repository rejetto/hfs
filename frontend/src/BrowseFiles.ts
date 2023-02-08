// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useLocation } from 'react-router-dom'
import { createElement as h, Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { domOn, formatBytes, hError, hfsEvent, hIcon, isMobile } from './misc'
import { Checkbox, Html, Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList from './useFetchList'
import useAuthorized from './useAuthorized'
import { acceptDropFiles, enqueue } from './upload'
import _ from 'lodash'

export function usePath() {
    return decodeURI(useLocation().pathname)
}

export interface DirEntry { n:string, s?:number, m?:string, c?:string,
    ext:string, isFolder:boolean, t?:Date } // we memoize these value for speed
export type DirList = DirEntry[]

export function BrowseFiles() {
    useFetchList()
    const { error, list, serverConfig } = useSnapState()
    return useAuthorized() && h(Fragment, {},
        h(Html, { code: serverConfig?.custom_header }),
        h(Head),
        hError(error)
        || h(list ? FilesList : Spinner))
}

function FilesList() {
    const { filteredList, list, loading, stoppedSearch, can_upload } = useSnapState()
    const midnight = useMidnight() // as an optimization we calculate this only once per list and pass it down
    const pageSize = 100
    const [page, setPage] = useState(0)
    const [extraPages, setExtraPages] = useState(0)
    const [scrolledPages, setScrolledPages] = useState(0)
    const offset = page * pageSize
    const theList = filteredList || list
    const total = theList.length
    const nPages = Math.ceil(total / pageSize)

    useEffect(() => setPage(0), [theList])
    useEffect(() => {
        document.scrollingElement?.scrollTo(0, 0)
        setExtraPages(0)
        setScrolledPages(0)
    }, [page])
    const calcScrolledPages = useMemo(() =>
        _.throttle(() => {
            const i = _.findLastIndex(document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS), el =>
                el.getBoundingClientRect().top <= window.innerHeight/2)
            setScrolledPages(i + 1)
        }, 200),
        [])
    useEffect(() => domOn('scroll', () => {
        if (!theList.length) return
        const timeToAdd = window.innerHeight * 1.3 + window.scrollY >= document.body.offsetHeight // 30vh before the end
        if (timeToAdd && page + extraPages < nPages -1)
            setExtraPages(extraPages+1)
        calcScrolledPages()
    }), [page, extraPages, nPages])

    const ref = useRef<HTMLElement>()

    const pageChange = useCallback((i: number) => {
        if (i < page || i > page + extraPages)
            return setPage(i)
        i -= page + 1
        const el = i < 0 ? ref.current?.querySelector('*')
            : document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS)[i]
        el?.scrollIntoView({ block: 'center' })
    }, [page, extraPages])

    return h(Fragment, {},
        h('ul', { ref, className: 'dir', ...acceptDropFiles(can_upload && enqueue) },
            !list.length ? (!loading && (stoppedSearch ? "Stopped before finding anything" : "Nothing here"))
                : filteredList && !filteredList.length ? "No match for this filter"
                    : theList.slice(offset, offset + pageSize * (1+extraPages)).map((entry: DirEntry, idx) =>
                        h(Entry, {
                            key: entry.n,
                            midnight,
                            separator: idx > 0 && !(idx % pageSize) ? String(offset + idx) : undefined,
                            ...entry
                        })),
            loading && h(Spinner),
        ),
        total > pageSize && h(Paging, {
            nPages,
            current: page + scrolledPages,
            pageSize,
            pageChange,
        })
    )
}

interface PagingProps {
    nPages: number
    current: number
    pageSize: number
    pageChange:(newPage:number) => void
}
const Paging = memo(({ nPages, current, pageSize, pageChange }: PagingProps) => {
    const ref = useRef<HTMLElement>()
    const pages = []
    for (let i=0; i<nPages; i++)
        pages.push(h('button', {
            ...i===current && { className:'toggled', ref },
            //@ts-ignore
            onClick(){
                pageChange(i)
            }
        }, i*pageSize || "Page 1"))
    useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [current])
    return h('div', { id:'paging' }, ...pages)
})

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

const PAGE_SEPARATOR_CLASS = 'page-separator'

const Entry = memo((entry: DirEntry & { midnight: Date, separator?: string }) => {
    let { n: relativePath, isFolder, separator } = entry
    const base = usePath()
    const { showFilter, selected } = useSnapState()
    const href = fixUrl(relativePath)
    const containerDir = isFolder ? '' : relativePath.substring(0, relativePath.lastIndexOf('/')+1)
    const name = relativePath.substring(containerDir.length)
    let className = isFolder ? 'folder' : 'file'
    if (separator)
        className += ' ' + PAGE_SEPARATOR_CLASS
    return h('li', { className, label: separator },
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
    return s.replace(/[#%]/g, encodeURIComponent)
}

const EntryProps = memo(function(entry: DirEntry & { midnight: Date }) {
    const { t, s } = entry
    const today = t && t > entry.midnight
    const shortTs = isMobile()
    const code = useMemo(()=> hfsEvent('additionalEntryProps', { entry }).join(''),
        [entry])
    return h('div', { className: 'entry-props' },
        h(Html, { code, className: 'add-props' }),
        s !== undefined && h(Fragment, {},
            h('span', { className: 'entry-size' }, formatBytes(s)),
            " — ",
        ),
        t && h('span', {
            className: 'entry-ts',
            title: today || !shortTs ? null : t.toLocaleString(),
            onClick() { // mobile has no hover
                if (shortTs)
                    alertDialog("Full timestamp:\n" + t.toLocaleString()).then()
            }
        }, !shortTs ? t.toLocaleString() : today ? t.toLocaleTimeString() : t.toLocaleDateString()),
    )
})

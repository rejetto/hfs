// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useLocation } from 'react-router-dom'
import {
    createElement as h,
    Fragment,
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import { domOn, formatBytes, hError, hIcon, isMobile } from './misc'
import { Checkbox, CustomCode, Html, Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList from './useFetchList'
import useAuthorized from './useAuthorized'
import { acceptDropFiles, enqueue } from './upload'
import _ from 'lodash'
import { useI18N } from './i18n'

export function usePath() {
    return decodeURI(useLocation().pathname)
}

export interface DirEntry { n:string, s?:number, m?:string, c?:string,
    ext:string, isFolder:boolean, t?:Date } // we memoize these value for speed
export type DirList = DirEntry[]

export function BrowseFiles() {
    useFetchList()
    const { error, list } = useSnapState()
    return useAuthorized() && h(Fragment, {},
        h(CustomCode, { name: 'beforeHeader' }),
        h(Head),
        h(CustomCode, { name: 'afterHeader' }),
        hError(error)
        || h(list ? FilesList : Spinner),
        h(CustomCode, { name: 'afterList' }),
    )
}

function FilesList() {
    const { filteredList, list, loading, stoppedSearch, can_upload } = useSnapState()
    const midnight = useMidnight() // as an optimization we calculate this only once per list and pass it down
    const pageSize = 100
    const [page, setPage] = useState(0)
    const [extraPages, setExtraPages] = useState(0)
    const [scrolledPages, setScrolledPages] = useState(0)
    const [atBottom, setAtBottom] = useState(false)
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
            setAtBottom(window.innerHeight + Math.ceil(window.scrollY) >= document.body.offsetHeight)
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

    const [goBottom, setGoBottom] = useState(false)
    useEffect(() => {
        if (!goBottom) return
        setGoBottom(false)
        window.scrollTo(0, document.body.scrollHeight)
    }, [goBottom])
    const pageChange = useCallback((i: number, pleaseGoBottom?: boolean) => {
        if (pleaseGoBottom)
            setGoBottom(true)
        if (i < page || i > page + extraPages)
            return setPage(i)
        i -= page + 1
        const el = i < 0 ? ref.current?.querySelector('*')
            : document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS)[i]
        el?.scrollIntoView({ block: 'center' })
    }, [page, extraPages])

    const {t} = useI18N()

    const msgInstead = !list.length ? (!loading && (stoppedSearch ? t('stopped_before', "Stopped before finding anything") : t('empty_list', "Nothing here")))
        : filteredList && !filteredList.length && t('filter_none', "No match for this filter")

    return h(Fragment, {},
        h('ul', { ref, className: 'dir', ...acceptDropFiles(can_upload && enqueue) },
            msgInstead ? h('p', {}, msgInstead)
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
            atBottom,
            pageSize,
            pageChange,
        })
    )
}

interface PagingProps {
    nPages: number
    current: number
    atBottom: boolean
    pageSize: number
    pageChange:(newPage:number, goBottom?:boolean) => void
}
const Paging = memo(({ nPages, current, pageSize, pageChange, atBottom }: PagingProps) => {
    useEffect(() => {
        document.body.style.overflowY = 'scroll'
        return () => { document.body.style.overflowY = '' }
    }, [])
    const ref = useRef<HTMLElement>()
    useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [current])
    const shrink = nPages > 20
    const from = _.floor(current, -1)
    const to = from + 10
    return h('div', { id:'paging' },
        h('button', {
            className: !current ? 'toggled' : undefined,
            onClick() { pageChange(0) },
        }, hIcon('to-start')),
        h('div', { id: 'paging-middle' },  // using sticky first/last would prevent scrollIntoView from working
            _.range(1, nPages).map(i =>
                (!shrink || !(i%10) || (i >= from && i < to)) // if shrinking, we show thousands or hundreds for current thousand
                    && h('button', {
                        key: i,
                        ...i === current && { className: 'toggled', ref },
                        onClick: () => pageChange(i),
                    }, shrink && !(i%10) ? (i/10) + 'K' : i * pageSize) )
        ),
        h('button', {
            className: atBottom ? 'toggled' : undefined,
            onClick(){ pageChange(nPages-1, true) }
        }, hIcon('to-end')),
    )
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
        isFolder ? h(Link, { to: base+href }, hIcon('folder'), relativePath.slice(0,-1))
            : h(Fragment, {},
                containerDir && h(Link, { to: base+fixUrl(containerDir), className:'container-folder' }, hIcon('file'), containerDir ),
                h('a', { href }, !containerDir && hIcon('file'),  name)
            ),
        h(CustomCode, { name: 'afterEntryName', props: { entry } }),
        h(EntryProps, entry),
        h('div'),
    )
})

function fixUrl(s:string) {
    return s.replace(/[#%]/g, encodeURIComponent)
}


const EntryProps = memo((entry: DirEntry & { midnight: Date }) => {
    const { t: time, s } = entry
    const today = time && time > entry.midnight
    const shortTs = isMobile()
    const {t} = useI18N()
    const dd = '2-digit'
    return h('div', { className: 'entry-props' },
        h(CustomCode, { name: 'additionalEntryProps', props: { entry } }),
        h(EntrySize, { s }),
        time && h('span', {
            className: 'entry-ts',
            onClick() { // mobile has no hover
                if (shortTs)
                    alertDialog(t`Full timestamp:` + "\n" + time.toLocaleString()).then()
            }
        }, time.toLocaleString(navigator.language, {
            ...!shortTs || !today ? { year: shortTs ? dd : 'numeric', month: dd, day: dd } : null,
            ...!shortTs || today ? { hour: dd, minute: dd } : null,
        })),
    )
})

const EntrySize = memo(({ s }: { s: DirEntry['s']  }) => {
    if (s === undefined) return null
    const a = formatBytes(s).split(' ')
    return h('span', { className: 'entry-size' }, a[0],
        h('span', { className: 'entry-size-unit' }, a[1]))
})
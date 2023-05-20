// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link } from 'react-router-dom'
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
import { domOn, formatBytes, ErrorMsg, hIcon, isMobile, getHFS } from './misc'
import { Checkbox, CustomCode, Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList, { usePath } from './useFetchList'
import { useAuthorized } from './login'
import { acceptDropFiles, enqueue } from './upload'
import _ from 'lodash'
import { t, useI18N } from './i18n'
import { deleteFiles } from './menu'
import { openFileMenu } from './fileMenu'

export interface DirEntry { n:string, s?:number, m?:string, c?:string, p?:string,
    name: string, uri: string, ext:string, isFolder:boolean, t?:Date, cantOpen: boolean } // we memoize these value for speed
export type DirList = DirEntry[]

export const MISSING_PERM = "Missing permission"

export function BrowseFiles() {
    useFetchList()
    const { error } = useSnapState()
    return useAuthorized() && h(Fragment, {},
        h(CustomCode, { name: 'beforeHeader' }),
        h(Head),
        h(CustomCode, { name: 'afterHeader' }),
        error ? h(ErrorMsg, { err: error }) : h(FilesList),
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
                        entry,
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
        }, hIcon('to_start')),
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
        }, hIcon('to_end')),
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

interface EntryProps { entry: DirEntry, midnight: Date, separator?: string }
const Entry = memo(({ entry, midnight, separator }: EntryProps) => {
    const { uri, isFolder } = entry
    const base = usePath()
    const { showFilter, selected, can_delete } = useSnapState()
    const containerDir = isFolder ? '' : uri.substring(0, uri.lastIndexOf('/')+1)
    const containerName = containerDir && entry.n.slice(0, -entry.name.length)
    let className = isFolder ? 'folder' : 'file'
    if (entry.cantOpen)
        className += ' cant-open'
    if (separator)
        className += ' ' + PAGE_SEPARATOR_CLASS
    const ico = getEntryIcon(entry)
    const menuOnLink = getHFS().fileMenuOnLink
    const onClick = menuOnLink && fileMenu || undefined
    const mobile = isMobile()
    return h('li', { className, label: separator },
        showFilter && h(Checkbox, {
            value: selected[uri],
            onChange(v){
                if (v)
                    return state.selected[uri] = true
                delete state.selected[uri]
            },
        }),
        isFolder
            ? h('span', { className: 'link-and-menu' }, // container to handle mouse over for both children
                h(Link, { to: base + uri }, ico, entry.n.slice(0,-1)),
                menuOnLink && h('button', { className: 'popup-menu-button', onClick: fileMenu }, hIcon('menu'), t`Menu`)
            )
            : h(Fragment, {},
                containerDir && h(Link, { to: base + containerDir, className:'container-folder' }, ico, containerName),
                h('a', { href: uri, onClick }, !containerDir && ico, entry.name)
            ),
        h(CustomCode, { name: 'afterEntryName', props: { entry } }),
        h('div', { className: 'entry-panel' },
            h(EntryDetails, { entry, midnight }),
            (!menuOnLink || isFolder && mobile) && h('button', { className: 'file-menu-button', onClick: fileMenu }, hIcon('menu')),
        ),
        h('div'),
    )

    function fileMenu(ev: MouseEvent) {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return
        ev.preventDefault()
        const open = { icon: 'play', label: t('file_open', "Open"), href: uri, target: isFolder ? undefined : '_blank' }
        openFileMenu(entry, ev, [
            menuOnLink && !entry.cantOpen && (
                !isFolder ? open : h(Link, { to: base + uri, onClick: () => close() }, hIcon(open.icon), open.label) ),
            can_delete &&  { label: t`Delete`, icon: 'trash', onClick: () => deleteFiles([uri], base) }
        ])
    }

})

export function getEntryIcon(entry: DirEntry) {
    return h(CustomCode, {
        name: 'entryIcon',
        props: { entry },
        ifEmpty: () => hIcon(entry.isFolder ? 'folder' : 'file')
    })
}

const EntryDetails = memo(({ entry, midnight }: { entry: DirEntry, midnight: Date }) => {
    const { t: time, s } = entry
    const today = time && time > midnight
    const shortTs = isMobile()
    const {t} = useI18N()
    const dd = '2-digit'
    return h('div', { className: 'entry-props entry-details' }, // entry-props is legacy
        h(CustomCode, { name: 'additionalEntryDetails', props: { entry } }),
        entry.p?.match(entry.isFolder ? /l/i : /r/i) && hIcon('password', { className: 'miss-perm', title: t(MISSING_PERM) }),
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
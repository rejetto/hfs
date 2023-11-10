// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useNavigate } from 'react-router-dom'
import { createElement as h, Fragment, memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowSize } from 'usehooks-ts'
import { domOn, formatBytes, ErrorMsg, hIcon, onlyTruthy } from './misc'
import { Checkbox, CustomCode, Spinner } from './components'
import { Head } from './Head'
import { DirEntry, state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList from './useFetchList'
import { loginDialog, useAuthorized } from './login'
import { acceptDropFiles, enqueue } from './upload'
import _ from 'lodash'
import { t, useI18N } from './i18n'
import { openFileMenu } from './fileMenu'

export const MISSING_PERM = "Missing permission"

export function BrowseFiles() {
    useFetchList()
    const { error } = useSnapState()
    const navigate = useNavigate()
    return useAuthorized() ? h(Fragment, {},
        h(CustomCode, { name: 'beforeHeader' }),
        h(Head),
        h(CustomCode, { name: 'afterHeader' }),
        error ? h(ErrorMsg, { err: error }) : h(FilesList),
        h(CustomCode, { name: 'afterList' }),
    ) : h(CustomCode, { name: 'unauthorized',
        ifEmpty: () => h('h1', {
            className: 'unauthorized',
            onClick: () => loginDialog(navigate)
        }, t`Unauthorized`)
    })
}

function FilesList() {
    const { filteredList, list, loading, stoppedSearch, props } = useSnapState()
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
        h('ul', {
            ref,
            className: 'dir',
            ...acceptDropFiles(files => props?.can_upload ? enqueue(files.map(file => ({ file })))
                : alertDialog(t("Upload not available"), 'warning') )
        },
            msgInstead ? h('p', {}, msgInstead)
                : theList.slice(offset, offset + pageSize * (1+extraPages)).map((entry, idx) =>
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

export function useMidnight() {
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
    const { showFilter, selected, file_menu_on_link } = useSnapState()
    const isLink = Boolean(entry.url)
    const containerDir = isFolder || isLink ? '' : uri.substring(0, (uri.lastIndexOf('/') || -1) +1)
    const containerName = containerDir && entry.n.slice(0, -entry.name.length)
    let className = isFolder ? 'folder' : 'file'
    if (entry.cantOpen)
        className += ' cant-open'
    if (separator)
        className += ' ' + PAGE_SEPARATOR_CLASS
    const ico = getEntryIcon(entry)
    const onClick = !isLink && !entry.web && file_menu_on_link && fileMenu || undefined
    const small = useWindowSize().width < 800
    const showingButton = !file_menu_on_link || isFolder && small
    return h('li', { className, label: separator },
        h(CustomCode, { name: 'entry', props: { entry }, ifEmpty: () => h(Fragment, {},
            showFilter && h(Checkbox, {
                disabled: isLink,
                value: selected[uri],
                onChange(v){
                    debugger
                    if (v)
                        return state.selected[uri] = true
                    delete state.selected[uri]
                },
            }),
            h('span', { className: 'link-wrapper' }, // container to handle mouse over for both children
                isFolder ? h(Fragment, {},
                        h(Link, { to: uri }, ico, entry.n.slice(0,-1)),
                        // popup button is here to be able to detect link-wrapper:hover
                        file_menu_on_link && !showingButton && h('button', { className: 'popup-menu-button', onClick: fileMenu }, hIcon('menu'), t`Menu`)
                    )
                    : containerDir ? h(Fragment, {},
                        h('a', { href: uri, onClick, tabIndex: -1 }, ico),
                        h(Link, { to: containerDir, className:'container-folder', tabIndex: -1 }, containerName),
                        h('a', { href: uri, onClick }, entry.name)
                    ) : h('a', { href: uri, onClick }, ico, entry.name),
            ),
            h(CustomCode, { name: 'afterEntryName', props: { entry } }),
            entry.comment && h('div', { className: 'entry-comment' }, entry.comment),
            h('div', { className: 'entry-panel' },
                h(EntryDetails, { entry, midnight }),
                showingButton && h('button', { className: 'file-menu-button', onClick: fileMenu }, hIcon('menu')),
            ),
            h('div'),
        ) }),
    )

    function fileMenu(ev: MouseEvent) {
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return
        ev.preventDefault()
        openFileMenu(entry, ev, onlyTruthy([
            file_menu_on_link && 'open',
            'delete',
            'show'
        ]))
    }

})

export function getEntryIcon(entry: DirEntry) {
    return h(CustomCode, {
        name: 'entryIcon',
        props: { entry },
        ifEmpty: () => entry.getDefaultIcon()
    })
}

export const EntryDetails = memo(({ entry, midnight }: { entry: DirEntry, midnight: Date }) => {
    const { t: time, s } = entry
    const today = time && time > midnight
    const shortTs = useWindowSize().width < 800
    const {t} = useI18N()
    const dd = '2-digit'
    return h('div', { className: 'entry-details' },
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
    return h('span', { className: 'entry-size', title: s.toLocaleString() }, a[0],
        h('span', { className: 'entry-size-unit' }, a[1]))
})
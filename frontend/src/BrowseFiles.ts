// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link } from 'wouter'
import { navigate } from './App'
import {
    createElement as h, Fragment, memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useId
} from 'react'
import { useEventListener, useMediaQuery, useWindowSize } from 'usehooks-ts'
import {
    domOn, ErrorMsg, hIcon, onlyTruthy, prefix, isMac, isCtrlKey, hfsEvent, formatTimestamp, restartAnimation,
    anyDialogOpen
} from './misc'
import { Checkbox, CustomCode, Bytes, iconBtn, Spinner } from './components'
import { Head } from './Head'
import { DirEntry, state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList, { usePath } from './useFetchList'
import { useAuthorized } from './login'
import _ from 'lodash'
import { makeOnClickOpen, openFileMenu } from './fileMenu'
import { ClipBar } from './clip'
import { fileShow, getShowComponent } from './show'
import i18n from './i18n'
import { dragFilesSource } from './dragFiles'
import { PAGE_SEPARATOR_CLASS, Paging, scrollIntoView } from './Paging'
const { t, useI18N } = i18n

export const MISSING_PERM = "Missing permission"

const originalTitle = document.title
export function BrowseFiles() {
    useFetchList()
    const { props, tile_size=0, error, title_with_path } = useSnapState()

    const path = usePath()
    const title = originalTitle + (title_with_path ? ' ' + decodeURIComponent(path).slice(1, -1) : '')
    useEffect(() => { document.title = title }, [title])
    useEffect(() => domOn('popstate', () => {
        document.title = '+' // workaround to title not changing after a dialog is closed
        document.title = title
    }), [title])

    const propsDropFiles = useMemo(() => ({
        id: 'files-dropper',
    }), [props])
    if (!useAuthorized())
        return h(CustomCode, { name: 'unauthorized' }, h('h1', { className: 'unauthorized' }, t`Unauthorized`) )
    return h('div', propsDropFiles, // element dedicated to drop-files to cover full screen
        h('div', {
            uri: path, // used by UI tests
            className: 'list-wrapper ' + (tile_size ? 'tiles-mode' : 'list-mode'),
            style: { '--tile-size': tile_size },
        },
            h(CustomCode, { name: 'beforeHeader' }),
            h(Head),
            h(CustomCode, { name: 'afterHeader' }),
            props?.comment && h('div', { className: 'entry-comment' }, props.comment),
            error ? h(ErrorMsg, { err: error }) : h(FilesList),
            h(CustomCode, { name: 'afterList' }),
            h('div', { id: 'afterListFiller', style: { flex: 1 }}),
            h(ClipBar),
            h(CustomCode, { name: 'footer' }),
        )
    )
}

function FilesList() {
    const snap = useSnapState()
    const midnight = useMidnight() // as an optimization, we calculate this only once per list and pass it down
    const pageSize = Math.max(1, Math.floor(snap.page_size ?? 100))
    const [offset, setOffset] = useState(0)
    const [extraPages, setExtraPages] = useState(0)
    const [scrolledPages, setScrolledPages] = useState(0)
    const [atBottom, setAtBottom] = useState(false)
    const theList = snap.filteredList || snap.list
    const total = theList.length
    const nPages = Math.ceil(total / pageSize)
    const page = Math.floor(offset / pageSize)
    const pageEnd = offset + pageSize * (1+extraPages) - 1
    const thisPage = theList.slice(offset, pageEnd + 1)

    useEffect(() => setOffset(0), [theList[0]]) // reset page if the list changes
    // reset scrolling if the page changes
    useEffect(() => {
        document.scrollingElement?.scrollTo(0, 0)
        setExtraPages(0)
        setScrolledPages(0)
    }, [offset])

    // continuous-scrolling
    const calcScrolledPages = useMemo(() =>
        _.throttle(() => {
            const i = _.findLastIndex(document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS), el =>
                el.getBoundingClientRect().top <= window.innerHeight/2)
            setScrolledPages(i + 1)
            setAtBottom(window.innerHeight + Math.ceil(window.scrollY) >= document.body.offsetHeight)
        }, 200),
        [])
    const canAddPage = pageEnd < total - 1
    useEffect(() => domOn('scroll', () => {
        if (!theList.length) return
        const timeToAdd = window.innerHeight * 1.3 + window.scrollY >= document.body.offsetHeight // 30vh before the end
        if (timeToAdd && canAddPage)
            setExtraPages(extraPages+1)
        calcScrolledPages()
    }), [page, extraPages, canAddPage])
    // when the list is not filling the screen, but we got more pages, introduce an artificial scrolling (via extra padding) so let the user trigger the continuous-scrolling
    const { height: windowHeight } = useWindowSize()
    useEffect(() => {
        const filler = document.getElementById('afterListFiller')
        const wrapper = filler?.closest('.list-wrapper') as HTMLElement | null
        if (!filler || !wrapper) return
        // when the after-list filler is still stretching, we add a tiny bottom padding so the page can overflow and trigger scrolling
        const shouldPad = canAddPage && filler.getBoundingClientRect().height > 0
        wrapper.style.paddingBottom = shouldPad ? '10px' : ''
        return () => { wrapper.style.paddingBottom = '' }
    }, [canAddPage, windowHeight, total, page, extraPages])

    // type to focus
    const [focus, setFocus] = useState('')
    const [focusSkip, setFocusSkip] = useState(0)
    useEffect(() => setFocus(''), [theList]) // reset
    const focusTypingId = 'focus-typing'
    const endReached = () => restartAnimation(document.getElementById(focusTypingId), 'spin .3s')
    const timeout = useRef()
    useEventListener('keydown', ev => {
        if (anyDialogOpen()) return // won't work while dialogs are open
        if (isCtrlKey(ev as any) === 'Backspace' && location.pathname > '/')
            return navigate(location.pathname + '..')
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return
        const { key } = ev
        if (key === 'Tab' && focusIndex >= 0) { // tab key while we are already focusing will cycle over matching entries
            const go = ev.shiftKey ? -1 : 1
            setFocusSkip(was => {
                if (go > 0 || was)
                    return was + go
                endReached()
                return was
            }) // we always try to go forward and skip more, and if no enough matching items are found, we adjust "focusSkip" back
            renewTimeout()
            ev.preventDefault()
            return
        }
        if (key === ' ' && !focus) return
        if ((ev.target as any)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return
        if (key.length === 1 || key === 'Backspace')
            ev.preventDefault()
        setFocus(was => {
            const will = key === 'Backspace' ? was.slice(0, -1)
                : key === 'Escape' ? ''
                : key.length === 1 ? was + key.toLocaleLowerCase()
                : was
            if (will !== was)
                renewTimeout()
            return will
        })

        function renewTimeout() {
            clearTimeout(timeout.current)
            timeout.current = setTimeout(() => setFocus(''), 5_000) as any
        }
    })
    const focusIndex = useMemo(() => {
        if (!focus) {
            setFocusSkip(0)
            return -1
        }
        let ret = search(offset) // first attempt within this page
        if (offset && (ret < 0 || ret > pageEnd))
            ret = search(0) // search again on the whole list
        if (ret >= 0)
            setOffset(Math.floor(ret / pageSize) * pageSize)
        return ret

        function search(offset: number) {
            let prev = offset - 1
            let leftToSkip = focusSkip
            while (1) {
                const ret = _.findIndex(theList, x => x.name.toLocaleLowerCase().normalize().startsWith(focus), prev + 1)
                if (ret < 0) {
                    if (offset || prev < offset) // this is not our last search, or prev is not a result
                        return -1
                    if (focusSkip)
                        setFocusSkip(x => x - leftToSkip - 1) // prev is a result, but let's lessen the skip
                    endReached()
                    return prev
                }
                if (! leftToSkip--)
                    return ret
                prev = ret
            }
            throw 'unreachable' // shut up ts
        }
    }, [focus, focusSkip])
    useEffect(() => { // wait for possible page-change before focusing
        if (focusIndex < 0) return
        const e = theList[focusIndex]
        if (!e) return
        (document.querySelector(`a[href="${e.url || e.uri}"]`) as HTMLElement)?.focus()
    }, [focusIndex])

    const ref = useRef<HTMLElement>()

    const [goBottom, setGoBottom] = useState(false)
    useEffect(() => {
        if (!goBottom) return
        setGoBottom(false)
        window.scrollTo(0, document.body.scrollHeight)
    }, [goBottom])
    const changePage = useCallback((i: number, pleaseGoBottom?: boolean) => {
        setFocus('')
        if (pleaseGoBottom)
            setGoBottom(true)
        if (i < page || i > page + extraPages)
            return setOffset(i * pageSize)
        i -= page + 1
        const el = i < 0 ? ref.current?.querySelector('*')
            : document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS)[i]
        scrollIntoView(el, 'center')
    }, [page, extraPages, pageSize])
    const changePageToIndex = useCallback((i: number) => {
        setFocus('')
        // alphabetical paging is entry-anchored, so the chosen group starts at the top instead of at the numeric page boundary
        setOffset(i)
    }, [])

    const {t} = useI18N()

    const msgInstead = snap.list.length ? snap.filteredList && !snap.filteredList.length && t('filter_none', "No match for this filter")
        : !snap.loading && (snap.searchManuallyInterrupted ? t('stopped_before', "Stopped before finding anything")
        : t('empty_list', "Nothing here"))

    const focusHint = `${t('focus_hint', "By typing on your keyboard, you search and focus the items in the list.")}\n\nESC: ${t`Cancel`}`
    return h(Fragment, {},
        focus && h('div', { id: focusTypingId, className: focusIndex < 0 ? 'focus-typing-mismatch' : '' }, focus,
            hIcon('info', { style: { cursor: 'default', marginLeft: '.3em' }, title: focusHint, onClick: () => alertDialog(focusHint) }) ),
        h('ul', { ref, className: 'dir' },
            msgInstead ? h('p', {}, msgInstead)
                : thisPage.map((entry, idx) =>
                    h(Entry, {
                        key: entry.key || entry.n,
                        midnight,
                        separator: idx > 0 && !(idx % pageSize) ? String(offset + idx) : undefined,
                        entry,
                    })),
            snap.loading && h(Spinner),
        ),
        total > pageSize && h(Paging, {
            nPages,
            current: page + scrolledPages,
            atBottom,
            pageSize,
            list: theList as DirEntry[],
            showAlphabet: snap.sort_by === 'name' && !snap.invert_order,
            changePage,
            changePageToIndex,
        })
    )
}

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

interface EntryProps { entry: DirEntry, midnight: Date, separator?: string }
const Entry = ({ entry, midnight, separator }: EntryProps) => {
    const { uri, isFolder, name, n } = entry
    const { showFilter, selected, file_menu_on_link } = useSnapState()
    const isLink = Boolean(entry.url)
    let className = isFolder ? 'folder' : 'file'
    if (entry.cantOpen)
        className += ' cant-open'
    if (separator)
        className += ' ' + PAGE_SEPARATOR_CLASS
    const hasHover = useMediaQuery('(hover: hover)')
    const showingButton = !file_menu_on_link || isFolder && !hasHover
    const ariaId = useId()
    const commonProps = {
        id: ariaId,
        'aria-label': prefix(name + ', ', isFolder ? t`Folder` : entry.web ? t`Web page` : isLink ? t`Link` : ''),
        ...dragFilesSource(entry),
        onClick: !isFolder && !isLink && !entry.web && file_menu_on_link && fileMenu || makeOnClickOpen(entry),
        children: h(Fragment, {},
            getEntryIcon(entry),
            h('span', { className: 'container-folder' }, n.slice(0, -name.length).replaceAll('/', '/ ')),
            h('span', { className: 'entry-name' }, name)
        )
    }
    return h(CustomCode, {
        name: 'entry',
        entry,
        render: x => x ? h('li', { className, label: separator }, x) : _.remove(state.list, { n }) && null // custom-code wants us to skip this entry
    },
        showFilter && h(Checkbox, {
            disabled: !entry.canSelect(),
            'aria-labelledby': ariaId,
            value: selected[uri] || false,
            onChange(v) {
                if (hfsEvent('entryToggleSelection', { entry }).isDefaultPrevented()) return
                if (v)
                    return state.selected[uri] = true
                delete state.selected[uri]
            },
        }),
        h('span', { className: 'link-wrapper' }, // container to handle mouse over for both children
            // we treat webpages as folders, with menu to comment
            !isFolder ? h('a', { href: entry.url || uri, ...commonProps, target: entry.target, rel: entry.target && 'noopener noreferrer' })
                : h(Fragment, {},
                    // without reloadDocument, once you enter the web page, the back button won't bring you back to the frontend
                    h(entry.web ? 'a' : Link, { href: uri, ...commonProps }), // Link = internal navigation
                    // popup button is here to be able to detect link-wrapper:hover
                    file_menu_on_link && !showingButton && h('button', {
                        className: 'popup-menu-button',
                        onClick: fileMenu
                    }, hIcon('menu'), t`Menu`)
                ),
        ),
        h(CustomCode, { name: 'afterEntryName', entry }),
        entry.comment && h('div', { className: 'entry-comment' }, entry.comment),
        h('div', { className: 'entry-panel' },
            h(EntryDetails, { entry, midnight }),
            showingButton && !isLink && iconBtn('menu', fileMenu, { className: 'file-menu-button' }),
        ),
        h('div'),
    )

    function fileMenu(ev: MouseEvent) {
        // meta on link is standard on mac to open in new tab, while we use it on Windows where it is the only key that's not used on links
        if (ev.altKey || ev.ctrlKey || isMac && ev.metaKey) return
        ev.preventDefault()
        const special = isMac ? ev.shiftKey : ev.metaKey
        if (special && getShowComponent(entry))
            return fileShow(entry, { startPlaying: true })
        void openFileMenu(entry, ev, onlyTruthy([
            file_menu_on_link && 'open',
            'delete',
            'show'
        ]))
    }

}

export function getEntryIcon(entry: DirEntry) {
    return h(CustomCode, { name: 'entryIcon', entry }, entry.getDefaultIcon())
}

export const EntryDetails = memo(({ entry, midnight }: { entry: DirEntry, midnight: Date }) => {
    const { sort_by } = useSnapState()
    const time = sort_by === 'creation' ? entry.c : entry.m
    const today = time && time > midnight
    const shortTs = useWindowSize().width < 800
    const {t} = useI18N()
    const dd = '2-digit'
    return h('div', { className: 'entry-details' },
        h(CustomCode, { name: 'additionalEntryDetails', entry }),
        entry.cantOpen && hIcon(entry.cantOpen === DirEntry.FORBIDDEN ? 'lock' : 'password', { className: 'miss-perm', title: t(MISSING_PERM) }),
        h(EntrySize, { s: entry.s }),
        time && h('span', {
            className: 'entry-ts',
            'aria-hidden': true,
            onClick() { // mobile has no hover
                if (shortTs)
                    void alertDialog(t`Full timestamp:` + "\n" + formatTimestamp(time))
            }
        }, formatTimestamp(time, {
            ...!shortTs || !today ? { year: shortTs ? dd : 'numeric', month: dd, day: dd } : null,
            ...!shortTs || today ? { hour: dd, minute: dd } : null,
        })),
    )
})

const EntrySize = memo(({ s }: { s: DirEntry['s']  }) =>
    s === undefined ? null : h(Bytes, { className: 'entry-size', bytes: s }) )

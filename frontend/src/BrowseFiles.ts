// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Link, useNavigate } from 'react-router-dom'
import {
    createElement as h, Fragment, memo, MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useId
} from 'react'
import { useEventListener, useMediaQuery, useWindowSize } from 'usehooks-ts'
import {
    domOn, ErrorMsg, hIcon, onlyTruthy, prefix, isMac, isCtrlKey, hfsEvent, formatTimestamp, restartAnimation
} from './misc'
import { Checkbox, CustomCode, Bytes, iconBtn, Spinner } from './components'
import { Head } from './Head'
import { DirEntry, state, useSnapState } from './state'
import { alertDialog } from './dialog'
import useFetchList, { usePath } from './useFetchList'
import { useAuthorized } from './login'
import { acceptDropFiles } from './upload'
import { enqueueUpload, getFilePath } from './uploadQueue'
import _ from 'lodash'
import { makeOnClickOpen, openFileMenu } from './fileMenu'
import { ClipBar } from './clip'
import { fileShow, getShowComponent } from './show'
import i18n from './i18n'
import { dragFilesSource } from './dragFiles'
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
        ...acceptDropFiles((files, to) =>
            props?.can_upload ? enqueueUpload(files.map(file => ({ file, path: getFilePath(file) })), location.pathname + to)
                : alertDialog(t("Upload not available"), 'warning')
        ),
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
            h('div', { style: { flex: 1 }}),
            h(ClipBar),
            h(CustomCode, { name: 'footer' }),
        )
    )
}

function FilesList() {
    const { filteredList, list, loading, searchManuallyInterrupted } = useSnapState()
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
    const pageEnd = offset + pageSize * (1+extraPages) - 1
    const thisPage = theList.slice(offset, pageEnd + 1)

    useEffect(() => setPage(0), [theList[0]]) // reset page if the list changes
    // reset scrolling if the page changes
    useEffect(() => {
        document.scrollingElement?.scrollTo(0, 0)
        setExtraPages(0)
        setScrolledPages(0)
    }, [page])

    // infinite scrolling
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

    // type to focus
    const [focus, setFocus] = useState('')
    const [focusSkip, setFocusSkip] = useState(0)
    useEffect(() => setFocus(''), [theList]) // reset
    const focusTypingId = 'focus-typing'
    const endReached = () => restartAnimation(document.getElementById(focusTypingId), 'spin .3s')
    const navigate = useNavigate()
    const timeout = useRef()
    useEventListener('keydown', ev => {
        if (ev.target !== document.body && !(ev.target && ref.current?.contains(ev.target as any))) return
        if (isCtrlKey(ev as any) === 'Backspace' && location.pathname > '/')
            return navigate(location.pathname + '..')
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return
        const { key } = ev
        if (key === 'Tab' && focus) {
            const go = ev.shiftKey ? -1 : 1
            setFocusSkip(was => {
                if (go > 0 || was)
                    return was + go
                endReached()
                return was
            }) // we always try to go forward, and skip more, and if no enough matching items are found, we adjust "focusSkip" back
            renewTimeout()
            ev.preventDefault()
            return
        }
        if (key === ' ' && !focus) return
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
            setPage(Math.floor(ret / pageSize))
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
        if (focusIndex >= 0)
            (document.querySelector(`a[href="${theList[focusIndex]?.uri}"]`) as HTMLElement)?.focus()
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
            return setPage(i)
        i -= page + 1
        const el = i < 0 ? ref.current?.querySelector('*')
            : document.querySelectorAll('.' + PAGE_SEPARATOR_CLASS)[i]
        el?.scrollIntoView({ block: 'center' })
    }, [page, extraPages])

    const {t} = useI18N()

    const msgInstead = !list.length ? (!loading && (searchManuallyInterrupted ? t('stopped_before', "Stopped before finding anything") : t('empty_list', "Nothing here")))
        : filteredList && !filteredList.length && t('filter_none', "No match for this filter")

    const focusHint = `${t('focus_hint', "By typing on your keyboard, you search and focus elements of the list.")}\n\nESC: ${t`Cancel`}`
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
            loading && h(Spinner),
        ),
        total > pageSize && h(Paging, {
            nPages,
            current: page + scrolledPages,
            atBottom,
            pageSize,
            changePage,
        })
    )
}

interface PagingProps {
    nPages: number
    current: number
    atBottom: boolean
    pageSize: number
    changePage: (newPage:number, goBottom?:boolean) => void
}
const Paging = memo(({ nPages, current, pageSize, changePage, atBottom }: PagingProps) => {
    useEffect(() => {
        document.body.style.overflowY = 'scroll'
        return () => { document.body.style.overflowY = '' }
    }, [])
    const ref = useRef<HTMLElement>()
    useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), [current])
    const shrink = nPages > 20
    const from = _.floor(current, -1)
    const to = from + 10
    return h('div', { id: 'paging' },
        h('button', {
            title: t('go_first', "Go to first item"),
            className: !current ? 'toggled' : undefined,
            onClick() { changePage(0) },
        }, hIcon('to_start')),
        h('div', { id: 'paging-middle' },  // using sticky first/last would prevent scrollIntoView from working
            _.range(1, nPages).map(i =>
                (!shrink || !(i%10) || (i >= from && i < to)) // if shrinking, we show thousands or hundreds for current thousand
                    && h('button', {
                        key: i,
                        ...i === current && { className: 'toggled', ref },
                        onClick: () => changePage(i),
                    }, shrink && !(i%10) ? (i/10) + 'K' : i * pageSize) )
        ),
        h('button', {
            title: t('go_last', "Go to last item"),
            className: atBottom ? 'toggled' : undefined,
            onClick(){ changePage(nPages-1, true) }
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
            !isFolder ? h('a', { href: uri, ...commonProps, target: entry.target, rel: entry.target && 'noopener noreferrer' })
                : h(Fragment, {},
                    // without reloadDocument, once you enter the web page, the back button won't bring you back to the frontend
                    h(Link, { to: uri, reloadDocument: entry.web, ...commonProps }), // Link = internal navigation
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
        openFileMenu(entry, ev, onlyTruthy([
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


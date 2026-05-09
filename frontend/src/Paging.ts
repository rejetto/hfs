// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, memo, useEffect, useMemo, useRef, useState } from 'react'
import _ from 'lodash'
import { DirEntry } from './state'
import { domOn, getHFS, hIcon } from './misc'
import i18n from './i18n'
const { t } = i18n

export const PAGE_SEPARATOR_CLASS = 'page-separator'

interface PagingProps {
    nPages: number
    current: number
    atBottom: boolean
    pageSize: number
    list: DirEntry[]
    showAlphabet: boolean
    changePage: (newPage:number, goBottom?:boolean) => void
    changePageToIndex: (entryIndex: number) => void
}

interface AlphabetGroup {
    label: string
    index: number
}

export const Paging = memo(({ nPages, current, pageSize, list, showAlphabet, changePage, changePageToIndex, atBottom }: PagingProps) => {
    const [alphabetOpen, setAlphabetOpen] = useState(false)
    useEffect(() => {
        document.body.style.overflowY = 'scroll'
        return () => { document.body.style.overflowY = '' }
    }, [])
    const lastScrollTimeRef = useRef(0)
    useEffect(() => domOn('scroll', () => lastScrollTimeRef.current = Date.now()), [])
    const ref = useRef<HTMLElement>()
    useEffect(() => { // in case the page changed using the continuous-scrolling, we want to re-center, but only if it happened for a user interaction different from the scrolling
        if (Date.now() - lastScrollTimeRef.current > 500)
            scrollIntoView(ref.current, 'nearest')
    }, [current])
    const shrink = nPages > 20
    const from = _.floor(current, -1)
    const to = from + 10
    const alphabetGroups = useMemo(() => showAlphabet ? getAlphabetGroups(list) : [], [list, showAlphabet])
    useEffect(() => {
        if (!alphabetGroups.length)
            setAlphabetOpen(false)
    }, [alphabetGroups.length])
    return h('div', { id: 'paging' },
        h('button', {
            title: t('go_first', "Go to first item"),
            className: !current ? 'toggled' : undefined,
            onClick() { changePage(0) },
        }, hIcon('to_start')),
        h('div', { id: 'paging-middle' },  // using sticky first/last would prevent scrollIntoView from working
            _.range(1, nPages).map(i => {
                if (shrink && i % 10 && (i < from || i >= to))
                    return false
                const pageStart = i * pageSize
                return h('button', {
                    key: i,
                    ...i === current && { className: 'toggled', ref },
                    onClick: () => changePage(i),
                }, shrink && !(i % 10) && pageStart >= 1000 ? (pageStart / 1000) + 'K' : pageStart)
            })
        ),
        h('button', {
            title: t('go_last', "Go to last item"),
            className: atBottom ? 'toggled' : undefined,
            onClick(){ changePage(nPages-1, true) }
        }, hIcon('to_end')),
        Boolean(alphabetGroups.length) && h(AlphabetPaging, {
            groups: alphabetGroups,
            open: alphabetOpen,
            toggleOpen: () => setAlphabetOpen(x => !x),
            close: () => setAlphabetOpen(false),
            changePage: i => {
                setAlphabetOpen(false)
                changePageToIndex(i)
            },
        }),
    )
})

interface AlphabetPagingProps {
    groups: AlphabetGroup[]
    open: boolean
    toggleOpen: () => void
    close: () => void
    changePage: (entryIndex: number) => void
}

function AlphabetPaging({ groups, open, toggleOpen, close, changePage }: AlphabetPagingProps) {
    const ref = useRef<HTMLElement>()
    useEffect(() => {
        if (!open) return
        return domOn('pointerdown', ev => {
            const el = ref.current
            // the outside listener is global, so clicks inside the popup must be ignored here
            if (el && ev.target instanceof Node && !el.contains(ev.target))
                close()
        })
    }, [open, close])
    return h('div', { ref, id: 'alphabet-paging', className: open ? 'open' : undefined },
        open && h('div', { id: 'alphabet-paging-bar' },
            groups.map(({ label, index }) =>
                h('button', {
                    key: label,
                    onClick: () => changePage(index),
                }, label))
        ),
        h('button', {
            id: 'alphabet-paging-toggle',
            title: t('alpha_idx', "Alphabetical index"),
            onClick: toggleOpen,
        }, t('alpha_idx_button', "AZ"))
    )
}

function getAlphabetGroups(list: DirEntry[]) {
    const groups: AlphabetGroup[] = []
    const seen = new Set<string>()
    list.forEach((entry, index) => {
        const label = getAlphabetGroup(entry.name)
        if (!label) return
        if (seen.has(label)) return
        seen.add(label)
        groups.push({ label, index })
    })
    // the list order can include non-letter entries and custom filename collation; the index stays tied to the first real entry
    return groups.length > 1 ? groups.sort((a, b) => getHFS().textSortCompare(a.label, b.label)) : []
}

function getAlphabetGroup(name: string) {
    const first = Array.from(name.trim())[0] || ''
    if (!first) return ''
    const latin = first.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
    if (/^[A-Z]$/.test(latin))
        return latin
    const upper = first.toLocaleUpperCase()
    return /\p{Letter}/u.test(upper) ? upper : ''
}

export function scrollIntoView(el: Element | undefined | null, block: ScrollLogicalPosition) {
    if (!el) return
    try { el.scrollIntoView({ block }) }
    catch { // firefox 52 rejects modern scrollIntoView options, so we fall back to the legacy boolean signature
        el.scrollIntoView(block === 'center')
    }
}

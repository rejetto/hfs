import { state, useSnapState } from './state'
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from 'usehooks-ts'
import { Checkbox, CustomCode } from './components'
import { getHFS, with_ } from './misc'
import { scrollIntoView } from './Paging'
import i18n from './i18n'
const { useI18N } = i18n

export function FilterBar() {
    const { list, filteredList, selected, patternFilter, showFilter } = useSnapState()
    const [filter, setFilter] = useState(patternFilter)
    const ref = useRef<HTMLDivElement>(null)
    const {t} = useI18N()

    useEffect(() => {
        if (showFilter && getHFS().menu_at_top) // a long folder comment can keep the filter below the viewport before it reaches its sticky position
            scrollIntoView(ref.current, 'nearest')
    }, [showFilter])

    state.patternFilter = useDebounce(showFilter ? filter : '', 300)
    const entries = filteredList || list
    const all = useMemo(() => showFilter
        && entries.some(x => x.canSelect())
        && entries.every(x => !x.canSelect() || selected[x.uri]), [showFilter, entries, selected])

    const tabIndex = showFilter ? undefined : -1
    return h('div', { id: 'filter-bar', ref, style: { display: showFilter ? undefined : 'none' } },
        h(Checkbox, {
            value: all,
            tabIndex,
            'aria-hidden': !showFilter,
            'aria-label': t`Select all`,
            onContextMenu(ev) {
                ev.preventDefault()
                select(undefined)
            },
            onChange(v, ev){
                const toggle = with_(ev.nativeEvent as any, v => v.ctrlKey || v.metaKey)
                select(toggle ? undefined : v)
            },
        }),
        h('input', {
            id: 'filter',
            placeholder: t`filter_placeholder`,
            autoComplete: 'off',
            value: filter,
            tabIndex,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        }),
        h(CustomCode, { name: 'afterFilter' }),
        h('span', {}, [
            with_(Object.keys(selected).length, n => n && t('select_count', { n })),
            with_(filteredList?.length, n => n !== undefined && n < list.length && t('filter_count', {n})),
        ].filter(Boolean).join(', ') ),
    )

    function select(will: boolean | undefined) { // undefined will cause toggle of each element
        const sel = state.selected
        for (const e of state.filteredList || state.list) {
            const { uri } = e
            const was = sel[uri] || false
            if (was === will) continue
            if (was)
                delete sel[uri]
            else if (e.canSelect())
                sel[uri] = true
        }
    }
}

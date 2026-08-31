import { state, useSnapState } from './state'
import { createElement as h, useMemo, useState } from 'react'
import { useDebounce } from 'usehooks-ts'
import { Checkbox, CustomCode } from './components'
import { with_ } from './misc'
import i18n from './i18n'
const { useI18N } = i18n

export function FilterBar() {
    const { list, filteredList, selected, patternFilter, showFilter } = useSnapState()
    const [filter, setFilter] = useState(patternFilter)
    const {t} = useI18N()

    state.patternFilter = useDebounce(showFilter ? filter : '', 300)
    const entries = filteredList || list
    const all = useMemo(() => showFilter
        && entries.some(x => x.canSelect())
        && entries.every(x => !x.canSelect() || selected[x.uri]), [showFilter, entries, selected])

    const tabIndex = showFilter ? undefined : -1
    return h('div', { id: 'filter-bar', style: { display: showFilter ? undefined : 'none' } },
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
            placeholder: t('filter_placeholder', "Type here to filter the list below"),
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
            with_(Object.keys(selected).length, n => n && t('select_count', { n }, "{n} selected")),
            with_(filteredList?.length, n => n !== undefined && n < list.length && t('filter_count', {n}, "{n} filtered")),
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

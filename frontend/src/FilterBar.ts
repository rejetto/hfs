import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { useDebounce } from 'usehooks-ts'
import { Checkbox } from './components'
import { useI18N } from './i18n'
import { usePath } from './useFetchList'

export function FilterBar() {
    const { list, filteredList, selected, patternFilter, showFilter } = useSnapState()
    const [all, setAll] = useState(false)
    const [filter, setFilter] = useState(patternFilter)
    useEffect(() => setAll(false), [patternFilter, usePath()]) // reset on change
    const {t} = useI18N()

    state.patternFilter = useDebounce(showFilter ? filter : '', 300)

    const sel = Object.keys(selected).length
    const fil = filteredList?.length
    return h('div', { id: 'filter-bar', className: showFilter ? 'show-sliding' : 'before-sliding' },
        h(Checkbox, {
            value: all,
            onChange(){
                const will = !all
                const sel = state.selected
                for (const { uri } of state.filteredList || state.list) {
                    const was = sel[uri]
                    if (was === will) continue
                    if (was)
                        delete sel[uri]
                    else
                        sel[uri] = true
                }

                setAll(will)
            },
        }),
        h('input', {
            id: 'filter',
            placeholder: t('filter_placeholder', "Type here to filter the list below"),
            autoComplete: 'off',
            value: filter,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        }),
        h('span', {}, [
            sel && t('select_count', { n:sel }, "{n} selected"),
            fil !== undefined && fil < list.length && t('filter_count', {n:fil}, "{n} filtered"),
        ].filter(Boolean).join(', ') ),
    )
}
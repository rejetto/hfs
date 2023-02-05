import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { Checkbox } from './components'

export function FilterBar() {
    const { patternFilter, showFilter } = useSnapState()
    const [all, setAll] = useState(false)
    const [filter, setFilter] = useState(patternFilter)
    useEffect(() => setAll(false), [patternFilter]) // reset on change

    ;[state.patternFilter] = useDebounce(showFilter ? filter : '', 300)

    if (!showFilter)
        return null
    return h('div', { id: 'filter-bar' },
        h(Checkbox, {
            value: all,
            onChange(){
                const will = !all
                const sel = state.selected
                for (const { n } of state.filteredList || state.list) {
                    const was = sel[n]
                    if (was === will) continue
                    if (was)
                        delete sel[n]
                    else
                        sel[n] = true
                }

                setAll(will)
            },
        }),
        h('input', {
            id: 'filter',
            placeholder: "Type here to filter the list below",
            autoComplete: 'off',
            value: filter,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        }),
    )
}
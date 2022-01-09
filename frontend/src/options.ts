import { newDialog } from './dialog'
import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Checkbox, FlexV, Select } from './components'
import { hIcon } from './misc'

export function showOptions (){
    const options = ['name','extension','size','time']
    const close = newDialog({ Content })

    function Content(){
        const snap = useSnapState()
        return h(FlexV, {},
            h('div', {}, 'Sort by'),
            options.map(x => h('button',{
                key: x,
                onClick(){
                    close(state.sortBy = x)
                }
            }, x, ' ', snap.sortBy===x && hIcon('check'))),
            h(Checkbox, {
                value: snap.foldersFirst,
                onChange(v) {
                    state.foldersFirst = v
                }
            }, 'Folders first'),

            h(Select, {
                options: ['light', 'dark'].map(s => ({ label:'theme: ' + s, value: s })),
                value: snap.theme,
                onChange(v) {
                    state.theme = v
                }
            })
        )
    }
}

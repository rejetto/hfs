// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { newDialog } from './dialog'
import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Checkbox, FlexV, Select } from './components'
import { hIcon } from './misc'
import { MenuLink } from './menu'

export function showOptions (){
    const options = ['name', 'extension', 'size', 'time']
    const close = newDialog({ Content })

    function Content(){
        const snap = useSnapState()
        return h(FlexV, {},
            snap.adminUrl && h(MenuLink, {
                icon: 'admin',
                label: "Admin interface",
                href: snap.adminUrl,
                target: 'admin',
            }),
            h('div', {}, "Sort by"),
            options.map(x => h('button',{
                key: x,
                onClick(){
                    close(state.sortBy = x)
                }
            }, x, ' ', snap.sortBy===x && hIcon('check'))),
            h(Checkbox, {
                value: snap.invertOrder,
                onChange(v) {
                    state.invertOrder = v
                }
            }, "Invert order"),
            h(Checkbox, {
                value: snap.foldersFirst,
                onChange(v) {
                    state.foldersFirst = v
                }
            }, "Folders first"),

            h(Select, {
                options: ['', 'light', 'dark'].map(s => ({ label: "theme: " + (s || "auto"), value: s })),
                value: snap.theme,
                onChange(v) {
                    state.theme = v
                }
            })
        )
    }
}

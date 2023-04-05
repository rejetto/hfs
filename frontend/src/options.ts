// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { newDialog } from './dialog'
import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Checkbox, FlexV, Select } from './components'
import { hIcon } from './misc'
import { MenuLink } from './menu'
import { t } from './i18n'

export function showOptions (){
    const options = ['name', 'extension', 'size', 'time']
    const close = newDialog({
        title: t`Options`,
        className: 'options-dialog',
        icon: () => hIcon('settings'),
        Content
    })

    function Content(){
        const snap = useSnapState()
        return h(FlexV, { gap: '1.2em' },
            snap.adminUrl && h(MenuLink, {
                icon: 'admin',
                label: t`Admin-panel`,
                href: snap.adminUrl,
                target: 'admin',
            }),
            h(FlexV, { gap: '.5em' },
                h('div', {}, t`Sort by`),
                options.map(x => h('button',{
                    key: x,
                    className: snap.sortBy === x ? 'toggled' : undefined,
                    onClick(){
                        close(state.sortBy = x)
                    }
                }, t(x)))
            ),
            h(Checkbox, {
                value: snap.invertOrder,
                onChange(v) {
                    state.invertOrder = v
                }
            }, t`Invert order`),
            h(Checkbox, {
                value: snap.foldersFirst,
                onChange(v) {
                    state.foldersFirst = v
                }
            }, t`Folders first`),
            h(Checkbox, {
                value: snap.sortNumerics,
                onChange(v) {
                    state.sortNumerics = v
                }
            }, t`Numeric names`),

            h(Select, {
                options: ['', 'light', 'dark'].map(s => ({ label: t`theme:` + ' ' + t(s || "auto"), value: s })),
                value: snap.theme,
                onChange(v) {
                    state.theme = v
                }
            })
        )
    }
}

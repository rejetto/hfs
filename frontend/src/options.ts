// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { newDialog } from './dialog'
import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Checkbox, FlexV, Select } from './components'
import { hIcon, MAX_TILES_SIZE } from './misc'
import { MenuLink } from './menu'
import { t } from './i18n'

export function showOptions (){
    const options = ['name', 'extension', 'size', 'time']
    newDialog({
        title: t`Options`,
        className: 'options-dialog',
        icon: () => hIcon('settings'),
        Content
    })

    function Content(){
        const snap = useSnapState()
        return h(FlexV, { gap: '1.5em' },
            snap.adminUrl && h(MenuLink, {
                icon: 'admin',
                label: t`Admin-panel`,
                href: snap.adminUrl,
                target: 'admin',
            }),
            h(Select, {
                options: options.map(x => ({
                    value: x,
                    label: t("Sort by:", { by: t(x) }, t`Sort by` + ': ' + t(x))
                })),
                value: snap.sortBy,
                onChange(v) {
                    state.sortBy = v
                }
            }),
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

            h('div', {},
                h('div', {}, t`Tiles mode:`, ' ', state.tilesSize || t`off`),
                h('input', {
                    type: 'range',
                    min: 0, max: MAX_TILES_SIZE,
                    value: snap.tilesSize || 0,
                    onChange(ev: any) {
                        state.tilesSize = Number(ev.target.value)
                    }
                }),
            ),

            h(Select, {
                options: ['', 'light', 'dark'].map(s => ({ label: t(["theme:", "Theme:", ]) + ' ' + t(s || "auto"), value: s })),
                value: snap.theme,
                onChange(v) {
                    state.theme = v
                }
            })
        )
    }
}

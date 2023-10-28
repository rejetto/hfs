// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { newDialog } from './dialog'
import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { Checkbox, FlexV, Select } from './components'
import { FRONTEND_OPTIONS, hIcon, MAX_TILE_SIZE, SORT_BY_OPTIONS, THEME_OPTIONS } from './misc'
import { MenuLink } from './menu'
import { t } from './i18n'
import _ from 'lodash'

export function showOptions (){
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
                options: SORT_BY_OPTIONS.map(x => ({
                    value: x,
                    label: t("Sort by:", { by: t(x) }, t`Sort by` + ': ' + t(x))
                })),
                value: snap.sort_by,
                onChange(v) {
                    state.sort_by = v
                }
            }),
            h(Checkbox, {
                value: snap.invert_order,
                onChange(v) {
                    state.invert_order = v
                }
            }, t`Invert order`),
            h(Checkbox, {
                value: snap.folders_first,
                onChange(v) {
                    state.folders_first = v
                }
            }, t`Folders first`),
            h(Checkbox, {
                value: snap.sort_numerics,
                onChange(v) {
                    state.sort_numerics = v
                }
            }, t`Numeric names`),

            h('div', {},
                h('div', {}, t`Tiles mode:`, ' ', state.tile_size || t`off`),
                h('input', {
                    type: 'range',
                    min: 0, max: MAX_TILE_SIZE,
                    value: snap.tile_size,
                    onChange(ev: any) {
                        state.tile_size = Number(ev.target.value)
                    }
                }),
            ),

            h(Select, {
                options: _.map(THEME_OPTIONS, (value, label) => ({ label: t(["theme:", "Theme:", ]) + ' ' + t(label), value })),
                value: snap.theme,
                onChange(v) {
                    state.theme = v
                }
            })
        )
    }
}

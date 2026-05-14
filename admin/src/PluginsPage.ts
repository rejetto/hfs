// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react'
import { Tab, Tabs } from '@mui/material'
import InstalledPlugins from './InstalledPlugins'
import OnlinePlugins from './OnlinePlugins'
import { useRoutedTab } from './routing'

const TABS = [
    { label: "Installed", path: 'installed', Pane: InstalledPlugins },
    { label: "Get more", path: 'get', Pane: OnlinePlugins },
    { label: "Check updates", path: 'updates', Pane: () => h(InstalledPlugins, { updates: true }) },
]
const TAB_PATHS = TABS.map(x => x.path)
export const PLUGIN_ERRORS = { ENOTFOUND: "Cannot reach github.com", ECONNREFUSED: "Cannot reach github.com" }

export default function PluginsPage() {
    const [tab, setTab] = useRoutedTab('plugins', TAB_PATHS)
    const { Pane } = TABS[tab]
    return h(Fragment, {},
        h(Tabs, {
            value: tab,
            onChange(ev, i) {
                setTab(i)
            }
        }, TABS.map(x =>
            h(Tab, { key: x.path, label: x.label }))),
        h(Pane)
    )
}

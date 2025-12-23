// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useState } from "react"
import { Tab, Tabs } from '@mui/material'
import InstalledPlugins from "./InstalledPlugins"
import OnlinePlugins from "./OnlinePlugins"
import { useBreakpoint } from "./mui"

const TABS = {
    "Installed": InstalledPlugins,
    "Get more": OnlinePlugins,
    "Check updates": () => h(InstalledPlugins, { updates: true }),
}
const LABELS = Object.keys(TABS)
const PANES = Object.values(TABS)
export const PLUGIN_ERRORS = { ENOTFOUND: "Cannot reach github.com", ECONNREFUSED: "Cannot reach github.com" }

export default function PluginsPage() {
    const [tab, setTab] = useState(0)
    return h(Fragment, {},
        h(Tabs, {
            value: tab,
            onChange(ev, i) {
                setTab(i)
            }
        }, LABELS.map(x =>
            h(Tab, { key: x, label: x }))),
        h(PANES[tab])
    )
}

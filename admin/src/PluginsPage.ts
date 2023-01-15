// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useState } from "react"
import { Tab, Tabs } from '@mui/material'
import InstalledPlugins from "./InstalledPlugins"
import OnlinePlugins from "./OnlinePlugins"

const TABS = {
    "Installed": InstalledPlugins,
    "Search online": OnlinePlugins,
    "Check updates": () => h(InstalledPlugins, { updates: true }),
}
const LABELS = Object.keys(TABS)
const PANES = Object.values(TABS)

export default function PluginsPage() {
    const [tab, setTab] = useState(0)
    return h(Fragment, {},
        h(Tabs, {
            value: tab,
            onChange(ev, i) {
                setTab(i)
            }
        }, LABELS.map(label => h(Tab, { label, key: label })) ),
        h(PANES[tab])
    )
}

// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useState } from "react"
import { Tab, Tabs } from '@mui/material'
import InstalledPlugins from "./InstalledPlugins"
import OnlinePlugins from "./OnlinePlugins"

export default function PluginsPage() {
    const [tab, setTab] = useState(0)
    const tabs = ["Installed", "Search online"]
    return h(Fragment, {},
        h(Tabs, { value: tab, onChange(ev,i){ setTab(i) } },
            tabs.map(f => h(Tab, { label: f, key: f })) ),
        h(tab ? OnlinePlugins : InstalledPlugins)
    )
}

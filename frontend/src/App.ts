// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom"
import { createElement as h, Fragment } from 'react'
import { BrowseFiles } from "./BrowseFiles"
import { Dialogs } from './dialog'
import useTheme from "./useTheme"
import { useSnapState } from './state'
import { I18Nprovider } from './i18n'
import { proxy, useSnapshot } from "valtio"
import { Spinner } from "./components"
import { enforceStarting, getHFS, getPrefixUrl, loadScript } from '@hfs/shared'
import { Toasts } from './toasts'

function App() {
    useTheme()
    const { ready } = useSnapshot(pageState) // wait for all plugins to be loaded
    const { messageOnly } = useSnapState()
    if (messageOnly)
        return h('h1', { style: { textAlign: 'center'} }, messageOnly)
    if (!ready)
        return h(Spinner, { style: { margin: 'auto' } })
    return h(I18Nprovider, {},
        h(BrowserRouter, {},
            h(NavigationExtractor, {},
                h(Toasts),
                h(Dialogs, {},
                    h(Routes, {},
                        h(Route, { path:'*', element: h(BrowseFiles) })
                    ),
                ),
            ),
        )
    )
}

function NavigationExtractor(props: any) {
    const go = useNavigate() // expose navigate function for programmatic usage
    getHFS().navigate = (uri: string) => go(getPrefixUrl() + enforceStarting('/', uri))
    return h(Fragment, props)
}

export default App;

const pageState = proxy({ ready: document.readyState === 'complete' })
document.addEventListener('readystatechange', () => {
    pageState.ready = document.readyState === 'complete'
})

// load plugins' now, as vite-legacy delayed app's loading
for (const [plugin, files] of Object.entries(getHFS().loadScripts))
    if (Array.isArray(files)) for (const f of files)
        loadScript(f, { plugin })
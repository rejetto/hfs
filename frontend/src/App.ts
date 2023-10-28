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

function App() {
    useTheme()
    const { ready } = useSnapshot(pageState) // wait for all plugins to be loaded
    const { messageOnly, tile_size=0 } = useSnapState()
    if (messageOnly)
        return h('h1', { style: { textAlign: 'center'} }, messageOnly)
    if (!ready)
        return h(Spinner, { style: { margin: 'auto' } })
    const style = { '--tile-size': tile_size }
    return h(I18Nprovider, {},
        h('div', { className: tile_size ? 'tiles-mode' : 'list-mode', style },
            h(BrowserRouter, {},
                h(NavigationExtractor, {},
                    h(Routes, {},
                        h(Route, { path:'*', element: h(BrowseFiles) })
                    ),
                ),
                h(Dialogs),
            )
        )
    )
}

// expose navigate function for programmatic usage
export let navigate: ReturnType<typeof useNavigate>
function NavigationExtractor(props: any) {
    navigate = useNavigate()
    return h(Fragment, props)
}

export default App;

const pageState = proxy({ ready: document.readyState === 'complete' })
document.addEventListener('readystatechange', () => {
    pageState.ready = document.readyState === 'complete'
})

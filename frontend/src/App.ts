// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { BrowserRouter, Route, Routes } from "react-router-dom"
import { createElement as h, Fragment } from 'react'
import { BrowseFiles } from "./BrowseFiles"
import { Dialogs } from './dialog'
import useTheme from "./useTheme"
import { useSnapState } from './state'

function App() {
    useTheme()
    const { messageOnly } = useSnapState()
    if (messageOnly)
        return h('h1', { style: { textAlign: 'center'} }, messageOnly)
    return h(Fragment, {},
        h(BrowserRouter, {},
            h(Routes, {},
                h(Route, { path:'*', element: h(BrowseFiles) })
            )
        ),
        h(Dialogs)
    )
}

export default App;

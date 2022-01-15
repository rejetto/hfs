import { BrowserRouter, Route, Routes } from "react-router-dom"
import { createElement as h, Fragment } from 'react'
import { BrowseFiles } from "./BrowseFiles";
import { Dialogs } from './dialog'
import useTheme from "./useTheme";

function App() {
    useTheme()
    return h(Fragment, {},
        h(BrowserRouter, {},
            h(Routes, {},
                h(Route, { path:'*', element:h(BrowseFiles) })
            )
        ),
        h(Dialogs)
    )
}

export default App;

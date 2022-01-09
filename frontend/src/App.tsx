import { BrowserRouter, Route, Routes } from "react-router-dom"
import { createElement as h, Fragment } from 'react'
import { BrowseFiles } from "./BrowseFiles";
import { Dialogs } from './dialog'
import { useApi } from "./api";
import useTheme from "./useTheme";

function App() {
    const extras = useApi('extras_to_load')
    useTheme()
    return h(Fragment, {},
        h(BrowserRouter, {},
            h(Routes, {},
                h(Route, { path:'*', element:h(BrowseFiles) })
            )
        ),
        extras?.css?.map((href:string) =>
            h('link', { key:href, rel:"stylesheet", type:"text/css", href })),
        h(Dialogs)
    )
}

export default App;

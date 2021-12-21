import { BrowserRouter, Route, Routes } from "react-router-dom"
import { createElement as h } from 'react'
import { BrowseFiles } from "./BrowseFiles";

function App() {
    return h(BrowserRouter, {},
        h(Routes, {},
            h(Route, { path:'*', element:h(BrowseFiles) })
        )
    )
}

export default App;

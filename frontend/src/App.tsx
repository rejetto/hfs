import { BrowserRouter, Route, Routes } from "react-router-dom"
import { createElement as h, Fragment, useEffect, useState } from 'react'
import { BrowseFiles } from "./BrowseFiles";
import { Dialogs } from './dialog'
import { useApi } from "./api";
import useTheme from "./useTheme";

function App() {
    const extras = useApi('extras_to_load')
    useTheme()
    if (!useImportJs(extras))
        return null
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

// return true when all is loaded
function useImportJs(extras:{ js?: string[] }) {
    const [ready, setReady] = useState(false)
    useEffect(() => {
        if (!extras) return
        const toImport = extras.js
        let missing = toImport?.length || 0
        if (!missing)
            return setReady(true)
        for (const url of toImport!) {
            const el = document.createElement('script')
            el.src = url
            el.onload = ()=> setReady(!--missing)
            document.body.appendChild(el)
        }
    }, [extras])
    return ready
}

import React from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom"
import { createElement as h, Fragment } from 'react'
import './App.css'
import { useApi } from './api'

function App() {
    return h(BrowserRouter, {},
        h(Routes, {},
            h(Route, { path:'*', element:h(BrowseFiles) })
        )
    )
}

export default App;

function BrowseFiles() {
    return h(Fragment, {},
        h(Head),
        h(FilesList))
}

function Head() {
    return null
}

interface FileObj { n:string, s?:number }

function FilesList() {
    const res = useApi('file_list', { path: useLocation().pathname })?.list
    if (!res)
        return h(Loading)
    return h('ul', {}, res.map(({ n }:FileObj) => {
        const isDir = n.endsWith('/')
        return h('li', { key: n },
            isDir ? h(Link, { to: n }, n)
                : h('a', { href: n }, n))
    }))
}

function Loading() {
    return 'loading' as React.ReactNode as React.ReactElement
}

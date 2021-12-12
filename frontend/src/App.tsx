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

interface DirEntry { n:string, s?:number, m?:string, c?:string }

function FilesList() {
    const path = useLocation().pathname
    let res = useApi('file_list', { path })?.list
    if (!res)
        return h(Loading)
    if (path > '/')
        res = [{ n: '../' }, ...res]
    return h('ul', { className:'dir' }, res.map((entry:DirEntry) => h(File, { key: entry.n, ...entry })))
}

function File({ n, m, c, s }: DirEntry) {
    const isDir = n.endsWith('/')
    const t = m||c ||null
    return h('li', {},
        isDir ? h(Link, { to: n }, hIcon('folder'), n)
            : h('a', { href: n }, hIcon('description'), n),
        h('div', { className:'entry-props' },
            s !== undefined && h(Fragment, {},
                h('span', { className:'entry-size' }, formatBytes(s)),
                hIcon('download'),
            ),
            t && h('span', { className:'entry-ts' }, new Date(t).toLocaleString()),
        ),
        h('div', { style:{ clear:'both' } })
    )
}

function hIcon(name: string) {
    return h(Icon, { name })
}

function Icon({ name }: { name:string }) {
    return h('span',{
        className: 'material-icons-outlined icon',
    }, name)
}

function Loading() {
    return 'loading' as React.ReactNode as React.ReactElement
}

function formatBytes(n: number, post: string = 'B') {
    if (isNaN(Number(n)))
        return ''
    let x = ['', 'K', 'M', 'G', 'T']
    let prevMul = 1
    let mul = 1024
    let i = 0
    while (i < x.length && n > mul) {
        prevMul = mul
        mul *= 1024
        ++i
    }
    n /= prevMul
    return round(n, 1) + ' ' + (x[i]||'') + post
} // formatBytes

function round(v: number, decimals: number = 0) {
    decimals = Math.pow(10, decimals)
    return Math.round(v * decimals) / decimals
} // round

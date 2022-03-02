// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import MainMenu, { getMenuLabel, mainMenu } from './MainMenu'
import { Box, ThemeProvider, Typography } from '@mui/material'
import { Dialogs } from './dialog'
import logo from './logo.svg'
import { useMyTheme } from './theme'

function App() {
    return h(ThemeProvider, { theme: useMyTheme() },
        h(BrowserRouter, {}, h(Routed)) )
}

function Routed() {
    const loc = useLocation().pathname.slice(1)
    const current = mainMenu.find(x => x.path === loc)
    const title = current && (current.title || getMenuLabel(current))
    return h(Box, { display: 'flex', sx: { bgcolor:'background.default', color: 'text.primary' } },
        h(MainMenu, { current }),
        h(Box, {
            component: 'main',
            sx: {
                flexGrow: 1,
                height: 'calc(100vh - 1em)',
                overflow: 'auto',
                px: 3,
                pb: '1em',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                background: 'url('+logo+') no-repeat center',
                backgroundSize: 'contain',
            }
        },
            title && h(Typography, { variant:'h1', mb:2 }, title),
            h(Routes, {},
                mainMenu.map((it,idx) => {
                    const element = it.comp ? h(it.comp) : h('div', {}, 'to be done')
                    return h(Route, { key: idx, path: it.path, element })
                })
            )
        ),
        h(Dialogs)
    )
}

export default App

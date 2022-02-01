import { createElement as h } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import MainMenu, { getMenuLabel, mainMenu } from './MainMenu';
import { Box, Typography } from '@mui/material'
import { Dialogs } from './dialog'

function App() {
    return h(BrowserRouter, {}, h(Routed))
}

function Routed() {
    const loc = useLocation().pathname.slice(1)
    const current = mainMenu.find(x => x.path === loc)
    const title = current && getMenuLabel(current)
    return h(Box, { display: 'flex' },
        h(MainMenu, { current }),
        h(Box, {
            component: 'main',
            sx: {
                flexGrow: 1,
                height: 'calc(100vh - 1em)',
                overflow: 'auto',
                px: 3,
                pb: '1em',
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

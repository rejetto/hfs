// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import MainMenu, { getMenuLabel, mainMenu } from './MainMenu'
import { AppBar, Box, Drawer, IconButton, ThemeProvider, Toolbar, Typography } from '@mui/material'
import { Dialogs } from './dialog'
import { useMyTheme } from './theme'
import { useBreakpoint} from './mui'
import { LoginRequired } from './LoginRequired'
import { Menu } from '@mui/icons-material'
import { LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import ConfigFilePage from './ConfigFilePage'
import { useSnapState } from './state'

function App() {
    return h(ThemeProvider, { theme: useMyTheme() },
        h(ApplyTheme, {},
            h(LocalizationProvider, { dateAdapter: AdapterDayjs },
                h(LoginRequired, {},
                    h(HashRouter, {}, h(Routed)) ) ) ) )
}

function ApplyTheme(props:any) {
    return h(Box, {
        sx: {
            bgcolor: 'background.default', color: 'text.primary',
            display: 'flex', flexDirection: 'column',
            minHeight: '100%', flex: 1,
            maxWidth: '100%',
        },
        ...props
    })
}

function Routed() {
    const loc = useLocation().pathname.slice(1)
    const current = mainMenu.find(x => x.path === loc)
    let { title } = useSnapState()
    title = current && (current.title || getMenuLabel(current)) || title
    const [open, setOpen] = useState(false)
    const large = useBreakpoint('lg')
    const xs = current?.noPaddingOnMobile ? 0 : 1
    return h(Fragment, {},
        !large && h(StickyBar, { title, openMenu: () => setOpen(true) }),
        !large && h(Drawer, { anchor:'left', open, onClose(){ setOpen(false) } },
            h(MainMenu, {
                onSelect: () => setOpen(false)
            })),
        h(Box, { display: 'flex', flex: 1, }, // horizontal layout for menu-content
            large && h(MainMenu),
            h(Box, {
                component: 'main',
                sx: {
                    background: 'url(cup.svg) no-repeat right fixed',
                    backgroundSize: 'contain',
                    px: { xs, md: 2, lg: 3 },
                    pb: { xs, md: 2 },
                    boxSizing: 'border-box', // keep padding inside the viewport
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    overflowX: 'clip', // keep wide things in space
                }
            },
                title && large && h(Typography, { variant:'h2', mb:2 }, title),
                h(Routes, {},
                    mainMenu.map((it,idx) =>
                        h(Route, { key: idx, path: it.path, element: h(it.comp) })),
                    h(Route, { path: 'edit', element: h(ConfigFilePage) })
                )
            ),
            h(Dialogs)
        )
    )
}

function StickyBar({ title, openMenu }: { title?: string, openMenu: ()=>void }) {
    return h(AppBar, { position: 'sticky', sx: { mb: 2 } },
        h(Toolbar, {},
            h(IconButton, {
                size: 'large',
                edge: 'start',
                color: 'inherit',
                sx: { mr: 2 },
                'aria-label': "menu",
                onClick: openMenu
            }, h(Menu)),
            title,
        )
    )
}

export default App

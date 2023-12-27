// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, FC } from 'react';
import { List, ListItemButton, ListItemIcon, ListItemText, Box } from '@mui/material'
import {
    AccountTree,
    Extension,
    History,
    Home,
    Logout,
    ManageAccounts,
    Monitor,
    Public,
    Settings,
    Translate,
    Code,
    SvgIconComponent
} from '@mui/icons-material'
import _ from 'lodash'
import { NavLink } from 'react-router-dom'
import MonitorPage from './MonitorPage'
import OptionsPage from './OptionsPage';
import VfsPage from './VfsPage';
import AccountsPage from './AccountsPage';
import HomePage from './HomePage'
import LogoutPage from './LogoutPage';
import LangPage from './LangPage'
import LogsPage from './LogsPage';
import PluginsPage from './PluginsPage';
import { getHFS } from '@hfs/shared'
import CustomHtmlPage from './CustomHtmlPage';
import InternetPage from './InternetPage'
import { replaceStringToReact } from './md'
import { useWindowSize } from 'usehooks-ts'

interface MenuEntry {
    path: string
    icon: SvgIconComponent
    label?: string
    title?: string
    comp: FC
    noPaddingOnMobile?: true
}

export const mainMenu: MenuEntry[] = [
    { path: '', icon: Home, label: "Home", title: "Admin panel", comp: HomePage },
    { path: 'fs', icon: AccountTree, label: "Shared files", comp: VfsPage },
    { path: 'accounts', icon: ManageAccounts, comp: AccountsPage },
    { path: 'options', icon: Settings, comp: OptionsPage },
    { path: 'internet', icon: Public, comp: InternetPage },
    { path: 'monitoring', icon: Monitor, comp: MonitorPage, noPaddingOnMobile: true },
    { path: 'logs', icon: History, comp: LogsPage, noPaddingOnMobile: true },
    { path: 'language', icon: Translate, comp: LangPage },
    { path: 'plugins', icon: Extension, comp: PluginsPage, noPaddingOnMobile: true },
    { path: 'html', icon: Code, label: "Custom HTML", comp: CustomHtmlPage },
    { path: 'logout', icon: Logout, comp: LogoutPage }
]

export default function Menu({ onSelect }: { onSelect: ()=>void }) {
    const { VERSION } = getHFS()
    const logo = 'hfs-logo.svg'
    const short = useWindowSize().height < 700
    return h(Box, { display: 'flex', flexDirection: 'column', bgcolor: 'primary.main', minHeight: '100%', },
        h(List, {
            sx:{
                pr: 1, py: 0, color: 'primary.contrastText',
                height: '100vh', boxSizing: 'border-box', // grow as screen permits, so we know the extra space for the logo
                overflowY: 'auto', // ...and account for clipping
                position: 'sticky', top: 0, // be independent (scrolling-wise)
                display: 'flex', flexDirection: 'column', '&>a': { flex: '0' },
            }
        },
            h(Box, { display: 'flex', px: 2, py: .5, gap: 2, alignItems: 'center' },
                h(Box, { fontSize: 'min(3rem, max(5vw, 4vh))' }, 'HFS'),
                h(Box, { fontSize: 'small' }, replaceStringToReact(VERSION||'', /-/, () => h('br'))),
                short && h('img', { src: logo, style: { height: '2.5em' } }),
            ),
            mainMenu.map(it =>
                h(ListItemButton, {
                    key: it.path,
                    to: it.path,
                    component: NavLink,
                    onClick: onSelect,
                    // @ts-ignore
                    style: ({ isActive }) => isActive ? { textDecoration: 'underline' } : {},
                    children: undefined, // shut up ts
                },
                    it.icon && h(ListItemIcon, { sx:{ color: 'primary.contrastText', minWidth: 48 } }, h(it.icon)),
                    h(ListItemText, { sx: { whiteSpace: 'nowrap' }, primary: getMenuLabel(it) })
                ) ),
            !short && h(Box, { sx: { flex: 1, opacity: .7, background: `url(${logo}) no-repeat bottom`, backgroundSize: 'contain', margin: 2 } }),
        )
    )
}

export function getMenuLabel(it: MenuEntry) {
    return it && (it.label ?? _.capitalize(it.path))
}

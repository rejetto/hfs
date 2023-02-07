// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, FC } from 'react';
import { List, ListItemButton, ListItemIcon, ListItemText, Box, Typography } from '@mui/material'
import {
    AccountTree,
    Extension,
    History,
    Logout,
    ManageAccounts,
    Monitor,
    Public,
    Settings,
    SvgIconComponent
} from '@mui/icons-material'
import _ from 'lodash'
import { NavLink } from 'react-router-dom'
import MonitorPage from './MonitorPage'
import ConfigPage from './ConfigPage';
import VfsPage from './VfsPage';
import AccountsPage from './AccountsPage';
import HomePage from './HomePage'
import LogoutPage from './LogoutPage';
import LogsPage from './LogsPage';
import { useApi } from './api'
import PluginsPage from './PluginsPage';

interface MenuEntry {
    path: string
    icon: SvgIconComponent
    label?: string
    title?: string
    comp: FC
}

export const mainMenu: MenuEntry[] = [
    { path: '', icon: Public, label: 'Home', title: "Admin panel", comp: HomePage },
    { path: 'fs', icon: AccountTree, label: "Shared files", comp: VfsPage },
    { path: 'accounts', icon: ManageAccounts, comp: AccountsPage },
    { path: 'configuration', icon: Settings, comp: ConfigPage },
    { path: 'monitoring', icon: Monitor, comp: MonitorPage },
    { path: 'logs', icon: History, comp: LogsPage },
    { path: 'plugins', icon: Extension, comp: PluginsPage },
    { path: 'logout', icon: Logout, comp: LogoutPage }
]

let version: any // cache 'version', as it won't change at runtime, while the Drawer mechanism will unmount our menu each time
export default function Menu({ onSelect }: { onSelect: ()=>void }) {
    const [status] = useApi(!version && 'get_status')
    version ||= status?.version?.replace('-', ' ')
    return h(List, {
        sx:{
            pr: 1, bgcolor: 'primary.main', color: 'primary.contrastText', minHeight: '100%', boxSizing: 'border-box',
            maxHeight: '100vh', // avoid reserving extra space for the final logo
            display: 'flex', flexDirection: 'column', '&>a': { flex: '0' },
        }
    },
        h(Box, { display: 'flex', px: 2, py: 1, gap: 2, alignItems: 'flex-end' },
            h(Typography, { variant:'h3' }, 'HFS'),
            h(Box, { pb: 1, fontSize: 'small' }, version),
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
                it.icon && h(ListItemIcon, { sx:{ color: 'primary.contrastText' } }, h(it.icon)),
                h(ListItemText, { primary: getMenuLabel(it) })
            ) ),
        h('img', { src: 'hfs-logo.svg', style: {
            opacity: .7, bottom: 0, marginLeft: 'auto', marginRight: 'auto', flex: 1,
                maxWidth: '80%', // using 'width' produces huge image on safari
                height: 0, // trick: without this the flex doesn't work
        } }),
    )
}

export function getMenuLabel(it: MenuEntry) {
    return it && (it.label ?? _.capitalize(it.path))
}

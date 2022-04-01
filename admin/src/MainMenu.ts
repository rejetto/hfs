// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, FC } from 'react';
import { List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import { AccountTree, Logout, ManageAccounts, Monitor, Public, Settings, SvgIconComponent } from '@mui/icons-material'
import _ from 'lodash'
import { NavLink } from 'react-router-dom'
import MonitorPage from './MonitorPage'
import ConfigPage from './ConfigPage';
import VfsPage from './VfsPage';
import AccountsPage from './AccountsPage';
import HomePage from './HomePage'
import LogoutPage from './LogoutPage';

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
    { path: 'monitor', icon: Monitor, comp: MonitorPage },
    { path: 'configuration', icon: Settings, comp: ConfigPage },
    { path: 'Logout', icon: Logout, comp: LogoutPage }
]

export default function Menu({ onSelect }: { onSelect: ()=>void }) {
    return h(List, { sx:{ pr:1, bgcolor: 'primary.main', color:'primary.contrastText', minHeight: '100%', boxSizing: 'border-box' } },
        h(Typography, { variant:'h4', sx:{ p:2 } }, 'HFS'),
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
            ) )
    )
}

export function getMenuLabel(it: MenuEntry) {
    return it && (it.label ?? _.capitalize(it.path))
}

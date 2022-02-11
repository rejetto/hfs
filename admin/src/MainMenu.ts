import { createElement as h, FunctionComponent } from 'react';
import { List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import { AccountTree, ManageAccounts, Monitor, Public, Settings, SvgIconComponent } from '@mui/icons-material'
import _ from 'lodash'
import { Link } from 'react-router-dom'
import MonitorPage from './MonitorPage'
import ConfigPage from './ConfigPage';
import VfsPage from './VfsPage';
import AccountsPage from './AccountsPage';
import HomePage from './HomePage'

interface MenuEntry {
    path: string
    icon: SvgIconComponent
    label?: string
    title?: string
    comp?: FunctionComponent
}

export const mainMenu: MenuEntry[] = [
    { path: '', icon: Public, label: 'Home', title: 'Admin interface', comp: HomePage },
    { path: 'monitor', icon: Monitor, comp: MonitorPage },
    { path: 'configuration', icon: Settings, comp: ConfigPage },
    { path: 'fs', icon: AccountTree, label: 'File System', comp: VfsPage },
    { path: 'accounts', icon: ManageAccounts, comp: AccountsPage },
]

interface MenuProps { current?:MenuEntry }
export default function Menu({ current }: MenuProps) {
    return h(List, { sx:{ pr:1, bgcolor: 'primary.main', color:'primary.contrastText'  } },
        h(Typography, { variant:'h4', sx:{ p:2 } }, 'HFS'),
        mainMenu.map(it =>
            h(ListItemButton, {
                key: it.path,
                sx: current===it ? { textDecoration: 'underline' } : undefined,
                //@ts-ignore
                component: Link, to: it.path,
            },
                it.icon && h(ListItemIcon, { sx:{ color: 'primary.contrastText' } }, h(it.icon)),
                h(ListItemText, { primary: getMenuLabel(it) })
            ) )
    )
}

export function getMenuLabel(it: MenuEntry) {
    return it && (it.label ?? _.capitalize(it.path))
}

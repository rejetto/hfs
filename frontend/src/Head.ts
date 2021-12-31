import { createElement as h, Fragment, useContext, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ListContext } from './BrowseFiles'
import { login, logout } from './login'
import { formatBytes, hIcon, prefix } from './misc'
import { Spinner } from './components'
import { state, useSnapState } from './state'
import { useDebounce } from 'use-debounce'
import { alertDialog, closeDialog, newDialog, promptDialog } from './dialog'
import { apiCall } from './api'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        h(Breadcrumbs),
        h(FolderStats),
        h('div', { style:{ clear:'both' }}),
    )
}

function MenuPanel() {
    const { remoteSearch, stopSearch, listFilter } = useSnapState()
    const [showFilter, setShowFilter] = useState(listFilter > '')
    const [filter, setFilter] = useState(listFilter)
    ;[state.listFilter] = useDebounce(showFilter ? filter : '', 300)
    const searchButtonProps = stopSearch ? {
        icon: 'stop',
        label: 'Stop list',
        className: 'ani-working',
        onClick() {
            stopSearch()
            state.stoppedSearch = true
        }
    } : state.remoteSearch ? {
        icon: 'search_off',
        label: 'Clear search',
        onClick() {
            state.remoteSearch = ''
        }
    } : {
        icon: 'search',
        label: 'Search',
        async onClick() {
            state.remoteSearch = await promptDialog('Search for...') ||''
        }
    }

    return h('div', { id:'menu-panel' },
        h('div', { id:'menu-bar' },
            h(LoginButton),
            h(MenuButton, {
                icon: 'filter',
                label: 'Filter',
                toggled: showFilter,
                onClick() {
                    setShowFilter(!showFilter)
                }
            }),
            h(MenuButton, searchButtonProps),
            h(MenuButton, {
                icon: 'archive',
                label: 'Archive',
                onClick() {
                    window.location.href = '?get=zip'
                }
            })
        ),
        remoteSearch && h('div', { id: 'searched' }, (stopSearch ? 'Searching' : 'Searched') + ': ' + remoteSearch),
        showFilter && h('input',{
            id: 'filter',
            placeholder: 'Filter',
            value: filter,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        }),
    )
}

function MenuButton({ icon, label, toggled, onClick, className='' }:{ icon:string, label:string, toggled?:boolean, className?:string, onClick?:()=>void }) {
    return h('button', { title:label, onClick, className:className+' '+(toggled ? 'toggled' : '') },
        hIcon(icon),
        h('label',{}, label))
}

function LoginButton() {
    const snap = useSnapState()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick(){
            newDialog({ content: UserPanel })
        },
    } : {
        icon: 'login',
        label: 'Login',
        async onClick(){
            const user = await promptDialog('Username')
            if (!user) return
            const password = await promptDialog('Password', { type:'password' })
            if (!password) return
            await login(user, password)
        }
    })
}

function UserPanel() {
    const snap = useSnapState()
    return h('div',{ id:'user-panel' },
        h('div',{}, 'User: '+snap.username),
        h(MenuButton,{
            icon: 'key',
            label: 'Change password',
            async onClick(){
                const pwd = await promptDialog('Enter new password', { type:'password' })
                if (!pwd) return
                const check = await promptDialog('RE-enter new password', { type:'password' })
                if (!check) return
                if (check !== pwd)
                    return alertDialog('The second password you entered did not match the first. Procedure aborted.', 'warning')
                await apiCall('change_pwd', { newPassword: pwd })
                return alertDialog('Password changed')
            }
        }),
        h(MenuButton,{
            icon: 'logout',
            label: 'Logout',
            onClick(){
                logout().then(closeDialog)
            }
        })
    )
}

function FolderStats() {
    const { list, loading } = useContext(ListContext)
    const stats = useMemo(() =>{
        let files = 0, folders = 0, size = 0
        for (const x of list) {
            if (x.n.endsWith('/'))
                ++folders
            else
                ++files
            size += x.s||0
        }
        return { files, folders, size }
    }, [list])
    const { filteredEntries, stoppedSearch } = useSnapState()
    return h('div', { id:'folder-stats' },
        stoppedSearch ? hIcon('interrupted', { title:'Search was interrupted' })
            : list?.length>0 && loading && h(Spinner),
        [
            prefix('', stats.files,' file(s)'),
            prefix('', stats.folders, ' folder(s)'),
            stats.size ? formatBytes(stats.size) : '',
            filteredEntries >= 0 && filteredEntries+' displayed',
        ].filter(Boolean).join(', ')
    )
}

function Breadcrumbs() {
    const path = useLocation().pathname.slice(1,-1)
    let prev = ''
    const breadcrumbs = path ? path.split('/').map(x => [prev = prev + x + '/', decodeURIComponent(x)]) : []
    return h(Fragment, {},
        h(Breadcrumb),
        breadcrumbs.map(([path,label]) => h(Breadcrumb, { key: path, path, label }))
    )
}

function Breadcrumb({ path, label }:{ path?: string, label?: string }) {
    const PAD = '\u00A0' // make small elements easier to tap. Don't use min-width 'cause it requires display-inline that breaks word-wrapping
    if (label && label.length < 3)
        label = PAD+label+PAD
    return h(Link, { className:'breadcrumb', to:path||'/' },
        label || hIcon('home') )
}


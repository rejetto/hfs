import { createElement as h, Fragment, useContext, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ListContext } from './BrowseFiles'
import { login, logout } from './login'
import { formatBytes, hIcon, prefix } from './misc'
import { Spinner } from './components'
import { state, useSnapState } from './state'
import { useDebounce } from 'use-debounce'

export function Head() {
    return h(Fragment, {},
        h('header', {},
            h(MenuPanel),
            h(Breadcrumbs),
        ),
        h(FolderStats)
    )
}

function MenuPanel() {
    const [showFilter, setShowFilter] = useState(false)
    const [filter, setFilter] = useState('')
    ;[state.listFilter] = useDebounce(filter, 300)
    return h('div', { id:'menu-panel' },
        h('div', { id:'menu-bar' },
            h(LoginButton),
            h(MenuButton, {
                icon: 'filter',
                label: 'Filter',
                onClick() {
                    setShowFilter(!showFilter)
                }
            })
        ),
        showFilter && h('input',{
            id:'filter',
            value: filter,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        })
    )
}

function MenuButton({ icon, label, onClick }:{ icon:string, label:string, onClick?:()=>void }) {
    return h('button', { title:label, onClick },
        hIcon(icon),
        h('label',{}, label))
}

function LoginButton() {
    const snap = useSnapState()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick(){
            if (window.confirm('Logout?'))
                logout()
        },
    } : {
        icon: 'login',
        label: 'Login',
        async onClick(){
            const user = prompt('Username')
            if (!user) return
            const password = prompt('Password')
            if (!password) return
            await login(user, password)
        }
    })
}

function FolderStats() {
    const { list, unfinished } = useContext(ListContext)
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
    const snap = useSnapState()
    return h('div', { id:'folder-stats' },
        unfinished && h(Spinner),
        [
            prefix('', stats.files,' file(s)'),
            prefix('', stats.folders, ' folder(s)'),
            stats.size ? formatBytes(stats.size) : '',
            snap.filteredEntries >= 0 && snap.filteredEntries+' displayed',
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
    return h(Link, { className:'breadcrumb', to:path||'/' },
        label || hIcon('home') )
}


import { createElement as h, Fragment, useContext, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ListContext } from './BrowseFiles'
import { login, logout } from './login'
import { formatBytes, hIcon, prefix, wait } from './misc'
import { Spinner } from './components'
import { state, useSnapState } from './state'
import { useDebounce } from 'use-debounce'

export function Head() {
    return h('header', {},
        h(MenuPanel),
        h(Breadcrumbs),
        h(FolderStats),
        h('div', { style:{ clear:'both' }}),
    )
}

function MenuPanel() {
    const [showFilter, setShowFilter] = useState(state.listFilter > '')
    const [filter, setFilter] = useState(state.listFilter)
    ;[state.listFilter] = useDebounce(filter, 300)
    if (!showFilter)
        state.listFilter = ''
    const { remoteSearch, stopSearch } = useSnapState()
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
            h(MenuButton, {
                icon: 'search',
                label: 'Search',
                async onClick() {
                    const res = prompt('Search for...')
                    if (res === null) return
                    if (state.stoppedSearch) {
                        state.remoteSearch = ''
                        await wait(500)
                    }
                    stopSearch?.()
                    state.remoteSearch = res
                }
            }),
            stopSearch && h(MenuButton, {
                icon: 'stop',
                label: 'Stop list',
                onClick() {
                    stopSearch()
                    state.stoppedSearch = true
                }
            })
        ),
        remoteSearch && h('div', { id:'searched' }, 'Searched for: ',remoteSearch),
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

function MenuButton({ icon, label, toggled, onClick }:{ icon:string, label:string, toggled?:boolean, onClick?:()=>void }) {
    return h('button', { title:label, onClick, className:toggled ? 'toggled' : '' },
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
        stoppedSearch ? hIcon('interrupted') : loading && h(Spinner),
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


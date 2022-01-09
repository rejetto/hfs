import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { promptDialog } from './dialog'
import { hIcon, prefix } from './misc'
import { login } from './login'
import { showOptions } from './options'
import showUserPanel from './UserPanel'

export function MenuPanel() {
    const { remoteSearch, stopSearch, stoppedSearch, listFilter } = useSnapState()
    const [showFilter, setShowFilter] = useState(listFilter > '')
    const [filter, setFilter] = useState(listFilter)
    ;[state.listFilter] = useDebounce(showFilter ? filter : '', 300)

    const [started1secAgo, setStarted1secAgo] = useState(false)
    useEffect(() => {
        if (!stopSearch) return
        setStarted1secAgo(false)
        setTimeout(() => setStarted1secAgo(true), 1000)
    }, [stopSearch])
    return h('div', { id: 'menu-panel' },
        h('div', { id: 'menu-bar' },
            h(LoginButton),
            h(MenuButton, {
                icon: 'filter',
                label: 'Filter',
                toggled: showFilter,
                onClick() {
                    setShowFilter(!showFilter)
                }
            }),
            h(MenuButton, getSearchProps()),
            h(MenuButton, {
                icon: 'settings',
                label: 'Options',
                onClick: showOptions
            }),
            h(MenuButton, {
                icon: 'archive',
                label: 'Archive',
                onClick() {
                    window.location.href = '?get=zip'
                }
            })
        ),
        remoteSearch && h('div', { id: 'searched' }, (stopSearch ? 'Searching' : 'Searched') + ': ' + remoteSearch + prefix(' (', stoppedSearch && 'interrupted', ')')),
        showFilter && h('input', {
            id: 'filter',
            placeholder: 'Filter',
            value: filter,
            autoFocus: true,
            onChange(ev) {
                setFilter(ev.target.value)
            }
        }),
    )


    function getSearchProps() {
        return stopSearch && started1secAgo ? {
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
                state.remoteSearch = await promptDialog('Search for...') || ''
            }
        }
    }
}

interface MenuButtonProps {
    icon: string,
    label: string,
    toggled?: boolean,
    className?: string,
    onClick?: () => void
}

export function MenuButton({ icon, label, toggled, onClick, className = '' }: MenuButtonProps) {
    return h('button', { title: label, onClick, className: className + ' ' + (toggled ? 'toggled' : '') },
        hIcon(icon),
        h('label', {}, label))
}

function LoginButton() {
    const snap = useSnapState()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick: showUserPanel
    } : {
        icon: 'login',
        label: 'Login',
        async onClick() {
            const user = await promptDialog('Username')
            if (!user) return
            const password = await promptDialog('Password', { type: 'password' })
            if (!password) return
            await login(user, password)
        }
    })
}



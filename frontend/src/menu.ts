import { state, useSnapState } from './state'
import { createElement as h, useEffect, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { alertDialog, closeDialog, newDialog, promptDialog } from './dialog'
import { hIcon, prefix } from './misc'
import { login, logout } from './login'
import { apiCall } from './api'
import { Checkbox, FlexV } from './components'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'

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
                icon: 'sort',
                label: 'Sort',
                onClick(){
                    const options = ['name','extension','size','time']
                    const close = newDialog({ Content })

                    function Content(){
                        const snap = useSnapState()
                        return h(FlexV, {},
                            h('div', {}, 'Sort by'),
                            options.map(x => h('button',{
                                key: x,
                                onClick(){
                                    close(state.sortBy = x)
                                }
                            }, x, ' ', snap.sortBy===x && hIcon('check'))),
                            h(Checkbox, {
                                value: snap.foldersFirst,
                                onChange(v) {
                                    state.foldersFirst = v
                                }
                            }, 'Folders first')
                        )
                    }
                }
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

function MenuButton({ icon, label, toggled, onClick, className = '' }: MenuButtonProps) {
    return h('button', { title: label, onClick, className: className + ' ' + (toggled ? 'toggled' : '') },
        hIcon(icon),
        h('label', {}, label))
}

function LoginButton() {
    const snap = useSnapState()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick() {
            newDialog({ Content: UserPanel })
        },
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

function UserPanel() {
    const snap = useSnapState()
    return h('div', { id: 'user-panel' },
        h('div', {}, 'User: ' + snap.username),
        h(MenuButton, {
            icon: 'key',
            label: 'Change password',
            async onClick() {
                const pwd = await promptDialog('Enter new password', { type: 'password' })
                if (!pwd) return
                const check = await promptDialog('RE-enter new password', { type: 'password' })
                if (!check) return
                if (check !== pwd)
                    return alertDialog('The second password you entered did not match the first. Procedure aborted.', 'warning')
                const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
                const res = await createVerifierAndSalt(srp6aNimbusRoutines, snap.username, pwd)
                await apiCall('change_srp', { salt: String(res.s), verifier: String(res.v) }).catch(e => {
                    if (e.code !== 406) // 406 = server was configured to support clear text authentication
                        throw e
                    return apiCall('change_password', { newPassword: pwd }) // unencrypted version
                })
                return alertDialog('Password changed')
            }
        }),
        h(MenuButton, {
            icon: 'logout',
            label: 'Logout',
            onClick() {
                logout().then(closeDialog)
            }
        })
    )
}


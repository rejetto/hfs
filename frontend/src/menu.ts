// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, useEffect } from 'react'
import { alertDialog, confirmDialog, ConfirmOptions, promptDialog } from './dialog'
import { hIcon, prefix, useStateMounted } from './misc'
import { loginDialog } from './login'
import { showOptions } from './options'
import showUserPanel from './UserPanel'
import { useNavigate } from 'react-router-dom'
import _ from 'lodash'
import { closeDialog } from '@hfs/shared/dialogs'
import { showUpload, uploadState } from './upload'
import { useSnapshot } from 'valtio'

export function MenuPanel() {
    const { showFilter, remoteSearch, stopSearch, stoppedSearch, selected, can_upload } = useSnapState()
    const { uploading, qs }  = useSnapshot(uploadState)
    useEffect(() => {
        if (!showFilter)
            state.selected = {}
    }, [showFilter])

    const [started1secAgo, setStarted1secAgo] = useStateMounted(false)
    useEffect(() => {
        if (!stopSearch) return
        setStarted1secAgo(false)
        setTimeout(() => setStarted1secAgo(true), 1000)
    }, [stopSearch, setStarted1secAgo])

    //TODO do something for list > 63KB as it hit the url limit (1kb reserved for the rest for the url)
    const list = Object.keys(selected).map(s => s.endsWith('/') ? s.slice(0,-1) : s).join('*')
    return h('div', { id: 'menu-panel' },
        h('div', { id: 'menu-bar' },
            h(LoginButton),
            h(MenuButton, {
                icon: 'filter',
                label: "Filter list",
                tooltip: "Show only elements matching text you type. Works on list already got from the server. Also enables selection of files, for selective \"Download zip\".",
                toggled: showFilter,
                onClick() {
                    state.showFilter = !showFilter
                }
            }),
            h(MenuButton, getSearchProps()),
            h(MenuButton, {
                icon: 'settings',
                label: 'Options',
                onClick: showOptions
            }),
            h(MenuLink, {
                icon: 'archive',
                label: "Download zip",
                tooltip: list ? "Download selected elements as a single zip file"
                    : "Download whole list (unfiltered) as a single zip file. If you select some elements, only those will be downloaded.",
                href: '?'+String(new URLSearchParams(_.pickBy({
                    get: 'zip',
                    search: remoteSearch,
                    list
                }))),
                ...!list && {
                    confirm: remoteSearch ? 'Download ALL results of this search as ZIP archive?' : 'Download WHOLE folder as ZIP archive?',
                    confirmOptions: {
                        afterButtons: h('button', {
                            onClick() {
                                state.showFilter = true
                                closeDialog(false)
                                return alertDialog("Use checkboxes to select the files, then you can use Download-zip again")
                            },
                        }, "Select some files"),
                    }
                }
            }),
            (can_upload || qs.length > 0) && h(MenuButton, {
                icon: 'upload',
                label: 'Upload',
                className: uploading && 'ani-working',
                onClick: showUpload,
            }),
        ),
        remoteSearch && h('div', { id: 'searched' },
            (stopSearch ? 'Searching' : 'Searched') + ': ' + remoteSearch + prefix(' (', stoppedSearch && 'interrupted', ')')),
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
        } : state.remoteSearch && !stopSearch ? {
            icon: 'search_off',
            label: 'Clear search',
            onClick() {
                state.remoteSearch = ''
            }
        } : {
            icon: 'search',
            label: "Search deep",
            async onClick() {
                state.remoteSearch = await promptDialog('Search for...') || ''
            }
        }
    }
}

interface MenuButtonProps {
    icon: string,
    label: string,
    tooltip?: string,
    toggled?: boolean,
    className?: string,
    onClick?: () => void
}

export function MenuButton({ icon, label, tooltip, toggled, onClick, className = '' }: MenuButtonProps) {
    return h('button', { title: tooltip || label, onClick, className: className + ' ' + (toggled ? 'toggled' : '') },
        hIcon(icon),
        h('label', {}, label))
}

export function MenuLink({ href, target, confirm, confirmOptions, ...rest }: MenuButtonProps & { href: string, target?: string, confirm?: string, confirmOptions?: ConfirmOptions }) {
    return h('a', {
        tabIndex: -1,
        href,
        target,
        async onClick(ev) {
            if (!confirm) return
            ev.preventDefault()
            await confirmDialog(confirm, { href, ...confirmOptions })
        }
    }, h(MenuButton, rest))
}

function LoginButton() {
    const snap = useSnapState()
    const navigate = useNavigate()
    return MenuButton(snap.username ? {
        icon: 'user',
        label: snap.username,
        onClick: showUserPanel
    } : {
        icon: 'login',
        label: 'Login',
        onClick: () => loginDialog(navigate),
    })
}

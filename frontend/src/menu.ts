// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { alertDialog, confirmDialog, ConfirmOptions, promptDialog } from './dialog'
import { err2msg, hError, hIcon, onlyTruthy, prefix, useStateMounted } from './misc'
import { loginDialog } from './login'
import { showOptions } from './options'
import showUserPanel from './UserPanel'
import { useLocation, useNavigate } from 'react-router-dom'
import _ from 'lodash'
import { closeDialog } from '@hfs/shared/dialogs'
import { showUpload, uploadState } from './upload'
import { useSnapshot } from 'valtio'
import { apiCall } from './api'
import { reloadList } from './useFetchList'

export function MenuPanel() {
    const { showFilter, remoteSearch, stopSearch, stoppedSearch, selected, can_upload, can_delete } = useSnapState()
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
    const { pathname } = useLocation()

    useEffect(() => {
        if (localStorage.warn_can_delete) return
        localStorage.warn_can_delete = 1
        alertDialog("To delete, first click Select").then()
    }, [can_delete])

    // passing files as string in the url should allow 1-2000 items before hitting the url limit of 64KB. Shouldn't be a problem, right?
    const list = useMemo(() => Object.keys(selected).map(s => s.endsWith('/') ? s.slice(0,-1) : s).join('*'), [selected])
    return h('div', { id: 'menu-panel' },
        h('div', { id: 'menu-bar' },
            h(LoginButton),
            showFilter && can_delete ? h(MenuButton, {
                    icon: 'trash',
                    label: "Delete",
                    onClick: () => deleteFiles(Object.keys(selected), pathname)
                })
                : (can_upload || qs.length > 0) && h(MenuButton, {
                icon: 'upload',
                label: "Upload",
                className: uploading && 'ani-working',
                onClick: showUpload,
            }),
            h(MenuButton, {
                icon: 'check',
                label: "Select",
                tooltip: `Selection applies to "Download zip", but you can also filter the list`,
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
            label: "Search",
            onClickAnimation: false,
            async onClick() {
                state.remoteSearch = await promptDialog("Search this folder and sub-folders") || ''
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
    onClickAnimation?: boolean
}

export function MenuButton({ icon, label, tooltip, toggled, onClick, onClickAnimation, className = '' }: MenuButtonProps) {
    const [working, setWorking] = useState(false)
    return h('button', {
        title: tooltip || label,
        onClick() {
            if (!onClick) return
            if (onClickAnimation !== false)
                setWorking(true)
            Promise.resolve(onClick()).finally(() => setWorking(false))
        },
        className: [className, toggled && 'toggled', working && 'ani-working'].filter(Boolean).join(' ')
    }, hIcon(icon), h('label', {}, label) )
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
        onClickAnimation: false,
        onClick: () => loginDialog(navigate),
    })
}

async function deleteFiles(uris: string[], root: string) {
    const n = uris.length
    if (!n) {
        alertDialog("Select something to delete").then()
        return
    }
    if (!await confirmDialog(`Delete ${n} item(s)?`)) return
    const errors = onlyTruthy(await Promise.all(uris.map(uri =>
        apiCall('del', { path: root + uri }).then(() => null, err => ({ uri, err }))
    )))
    reloadList()
    const e = errors.length
    alertDialog(h(Fragment, {},
        `Deletion: ${n - e} completed`,
        e > 0 && `, ${e} failed`,
        h('div', { style: { textAlign: 'left', marginTop: '1em', } },
            ...errors.map(e => h(Fragment, {},
                hError(err2msg(e.err) + ': ' + e.uri),
            ))
        )
    )).then()
}
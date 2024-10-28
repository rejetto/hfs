// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, Fragment, useEffect, useMemo, useState } from 'react'
import { alertDialog, confirmDialog, ConfirmOptions, formDialog, toast } from './dialog'
import {
    defaultPerms, err2msg, ErrorMsg, onlyTruthy, prefix, useStateMounted, VfsPerms, working,
    buildUrlQueryString, hIcon, WIKI_URL
} from './misc'
import { loginDialog } from './login'
import { showOptions } from './options'
import showUserPanel from './UserPanel'
import _ from 'lodash'
import { closeDialog } from '@hfs/shared/dialogs'
import { showUpload } from './upload'
import { uploadState } from './uploadQueue'
import { useSnapshot } from 'valtio'
import { apiCall } from '@hfs/shared/api'
import { reloadList } from './useFetchList'
import { t, useI18N } from './i18n'
import { cut } from './clip'
import { Btn, BtnProps, CustomCode } from './components'

export function MenuPanel() {
    const { showFilter, remoteSearch, stopSearch, searchManuallyInterrupted, selected, props, searchOptions } = useSnapState()
    const { can_upload, can_delete, can_archive } = props ? { ...defaultPerms, ...props } : {} as VfsPerms
    const { uploading, qs }  = useSnapshot(uploadState)
    useEffect(() => {
        if (!showFilter)
            state.selected = {}
    }, [showFilter])

    const {t} = useI18N()

    const [justStarted, setJustStarted] = useStateMounted(false)
    useEffect(() => {
        if (!stopSearch) return
        setJustStarted(false)
        setTimeout(() => setJustStarted(true), 1000)
    }, [stopSearch, setJustStarted])

    // passing files as string in the url should allow 1-2000 items before hitting the url limit of 64KB. Shouldn't be a problem, right?
    const ofs = location.pathname.length
    const list = useMemo(() => Object.keys(selected).map(s => s.slice(ofs, s.endsWith('/') ? -1 : Infinity)).join('*'), [selected])

    // avoid useless dom changes while we are still waiting for necessary data
    const [changingButton, setChangingButton] = useState<'' | 'upload' | 'delete'>('')
    useEffect(() => {
        if (can_upload !== undefined)
            setChangingButton(showFilter && can_delete ? 'delete' : (can_upload || qs.length > 0) ? 'upload' : '')
    }, [showFilter, can_delete, can_upload, qs.length])
    return h('div', { id: 'menu-panel' },
        h('div', { id: 'menu-bar' },
            h(LoginButton),
            h(Btn, {
                id: 'select-button',
                icon: 'check',
                label: t`Select`,
                tooltip: t('select_tooltip', `Selection applies to "Zip" and "Delete" (when available), but you can also filter the list`),
                toggled: showFilter,
                onClick() {
                    state.showFilter = !showFilter
                }
            }),
            h(Btn, changingButton === 'delete' ? {
                id: 'delete-button',
                icon: 'delete',
                label: t`Delete`,
                className: 'show-sliding',
                disabled: !list.length,
                tooltip: t('delete_select', "Select something to delete"),
                onClick: () => deleteFiles(Object.keys(selected))
            } : {
                id: 'upload-button',
                icon: 'upload',
                label: t`Upload`,
                disabled: !changingButton,
                tabIndex: changingButton ? undefined : -1,
                className: changingButton ? 'show-sliding ' + (uploading ? 'ani-working' : '') : 'before-sliding',
                onClick: showUpload,
            }),
            h(Btn, showFilter && can_delete ? {
                id: 'cut-button',
                icon: 'cut',
                label: t`Cut`,
                onClick() {
                    cut(onlyTruthy(Object.keys(selected).map(uri => _.find(state.list, { uri }))))
                }
            } : getSearchProps()),
            h(Btn, {
                id: 'options-button',
                icon: 'settings',
                label: t`Options`,
                onClick: showOptions
            }),
            h(CustomCode, { name: 'menuZip' }, h(MenuLink, {
                id: 'zip-button',
                icon: 'archive',
                label: t`Zip`,
                disabled: !can_archive,
                tooltip: list ? t('zip_tooltip_selected', "Download selected elements as a single zip file")
                    : t('zip_tooltip_whole', "Download whole list (unfiltered) as a single zip file. If you select some elements, only those will be downloaded."),
                href: buildUrlQueryString(_.pickBy({
                    get: 'zip',
                    search: remoteSearch,
                    list
                })),
                ...!list && {
                    confirm: remoteSearch ? t('zip_confirm_search', "Download ALL results of this search as ZIP archive?")
                        : t('zip_confirm_folder', "Download WHOLE folder as ZIP archive?"),
                    confirmOptions: {
                        afterButtons: h('button', {
                            onClick() {
                                state.showFilter = true
                                closeDialog(false)
                                return alertDialog(t('zip_checkboxes', "Use checkboxes to select the files, then you can use Zip again"))
                            },
                        }, t`Select some files`),
                    }
                }
            })),
            h(CustomCode, { name: 'appendMenuBar' }),
        ),
        remoteSearch && h('div', { id: 'searched' },
            (stopSearch ? t`Searching` : t`Searched`) + ': ' + remoteSearch + prefix(' (', searchManuallyInterrupted && t`interrupted`, ')')),
    )

    function getSearchProps() {
        return stopSearch && justStarted ? { // don't change the state of the search button immediately to avoid it flicking at every folder change
            id: 'search-stop-button',
            icon: 'stop',
            label: t`Stop list`,
            className: 'ani-working',
            onClick() {
                stopSearch()
                state.searchManuallyInterrupted = true
            }
        } : state.remoteSearch && !stopSearch ? {
            id: 'search-clear-button',
            icon: 'search_off',
            label: t`Clear search`,
            onClick() {
                state.remoteSearch = ''
            }
        } : {
            id: 'search-button',
            icon: 'search',
            label: t`Search`,
            onClickAnimation: false,
            onClick: () => formDialog({
                title: t`Search`,
                Content: () => h('div', {},
                    h('label', { htmlFor: 'text' }, t('search_msg', "Search this folder and sub-folders")),
                    h('input', {
                        name: 'text',
                        style: { width: 0, minWidth: '100%', maxWidth: '100%', boxSizing: 'border-box' },
                        autoFocus: true,
                    }),
                    h('div', { style: { margin: '1em 0' } },
                        h('input', {
                            type: 'checkbox',
                            name: 'wild',
                            defaultChecked: searchOptions.wild,
                            style: { marginRight: '1em' },
                        }),
                        "Wildcards",
                        h('a', { href: `${WIKI_URL}Wildcards`, target: 'doc' }, hIcon('info')),
                    ),
                    h('div', { style: { textAlign: 'right', marginTop: '.8em' } },
                        h('button', {}, t`Continue`)),
                )
            }).then(res => {
                if (!res) return
                const { text='', wild, ...rest } = res
                state.searchOptions = { ...rest, wild: Boolean(wild) }
                state.remoteSearch = text
                state.stopSearch?.()
            })
        }
    }
}

export function MenuLink({ href, target, confirm, confirmOptions, id, ...rest }: BtnProps & { href: string, target?: string, confirm?: string, confirmOptions?: ConfirmOptions }) {
    return h('a', {
        tabIndex: -1,
        href,
        target,
        id,
        async onClick(ev) {
            if (!confirm) return
            ev.preventDefault()
            await confirmDialog(confirm, { href, title: t`Confirm`, ...confirmOptions })
        }
    }, h(Btn, rest))
}

function LoginButton() {
    const snap = useSnapState()
    const {t} = useI18N()
    return Btn(snap.username ? {
        id: 'user-button',
        className: 'toggled', // without aria-pressed
        icon: 'user',
        label: snap.username,
        onClick: showUserPanel
    } : {
        id: 'login-button',
        icon: 'login',
        label: t`Login`,
        onClickAnimation: false,
        onClick: () => loginDialog(),
    })
}

export async function deleteFiles(uris: string[]) {
    const n = uris.length
    if (!await confirmDialog(t('delete_confirm', {n}, "Delete {n,plural, one{# item} other{# items}}?")))
        return false
    const stop = working()
    const errors = onlyTruthy(await Promise.all(uris.map(uri =>
        apiCall('delete', { uri }).then(() => null, err => ({ uri, err }))
    )))
    stop()
    reloadList()
    const e = errors.length
    const msg = t('delete_completed', {n: n-e}, "Deletion: {n} completed")
    if (n === 1 && !e)
        return toast(msg, 'success')
    void alertDialog(h(Fragment, {},
        msg, e > 0 && t('delete_failed', {n:e}, ", {n} failed"),
        h('div', { style: { textAlign: 'left', marginTop: '1em', } },
            ...errors.map(e => h(ErrorMsg, { err: t(err2msg(e.err)) + ': ' + e.uri }))
        )
    ))
}
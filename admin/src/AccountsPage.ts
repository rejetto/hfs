// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useState, useEffect, Fragment } from "react"
import { apiCall, useApiEx } from './api'
import { Alert, Box, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Close, Delete, DoNotDisturb, Group, MilitaryTech, Person, PersonAdd, Schedule } from '@mui/icons-material'
import { newDialog, with_ } from './misc'
import { Btn, Flex, IconBtn, iconTooltip, reloadBtn, useBreakpoint } from './mui'
import { TreeItem, TreeView } from '@mui/x-tree-view'
import MenuButton from './MenuButton'
import AccountForm from './AccountForm'
import md from './md'
import _ from 'lodash'
import { alertDialog, confirmDialog } from './dialog'
import { useSnapState } from './state'
import { importAccountsCsv } from './importAccountsCsv'
import { AccountAdminSend } from '../../src/api.accounts'

export type Account = AccountAdminSend

export default function AccountsPage() {
    const { username } = useSnapState()
    const { data, reload, element } = useApiEx('get_accounts')
    const [sel, setSel] = useState<string[] | 'new-group' | 'new-user'>([])
    const selectionMode = Array.isArray(sel)
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (Array.isArray(data?.list) && selectionMode)
            setSel( sel.filter(u => data.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [data]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    const list: Account[] | undefined = data?.list
    const selectedAccount = selectionMode && _.find(list, { username: sel[0] })
    const sideBreakpoint = 'md'
    const isSideBreakpoint = useBreakpoint(sideBreakpoint)

    const sideContent = !(sel.length > 0) || !list ? null // this clever test is true both when some accounts are selected and when we are in "new account" modes
        : selectionMode && sel.length > 1 ? h(Fragment, {},
                h(Flex, {},
                    h(Typography, {variant: 'h6'}, sel.length + " selected"),
                    h(Btn, { onClick: deleteAccounts, icon: Delete }, "Remove"),
                ),
                h(List, {},
                    sel.map(username =>
                        h(ListItem, { key: username },
                            h(ListItemText, {}, username))))
            )
            : with_(selectedAccount || { username: '', hasPassword: sel === 'new-user', adminActualAccess: false, invalidated: true }, a =>
                h(AccountForm, {
                    account: a,
                    groups: list.filter(x => !x.hasPassword).map( x => x.username ),
                    addToBar: isSideBreakpoint && [
                        h(Box, { flex:1 }),
                        account2icon(a, { fontSize: 'large', sx: { p: 1 }}),
                        // not really useful, but users misled in thinking it's a dialog will find satisfaction in dismissing the form
                        h(IconBtn, {  icon: Close, title: "Close", onClick: selectNone }),
                    ],
                    reload,
                    done(username) {
                        setSel([username])
                        reload()
                    }
                }))
    useEffect(() => {
        if (isSideBreakpoint || !sideContent || !sel.length) return
        const { close } = newDialog({
            title: _.isString(sel) ? _.startCase(sel)
                : sel.length > 1 ? "Multiple selection"
                    : selectedAccount ? (selectedAccount.hasPassword ? "User: " : "Group: ") + selectedAccount.username
                        : '?', // never
            Content: () => sideContent,
            onClose: selectNone,
        })
        return close
    }, [isSideBreakpoint, sel, selectedAccount])

    return element || h(Grid, { container: true, maxWidth: '80em' },
        h(Grid, { item: true, xs: 12 },
            h(Box, {
                display: 'flex',
                flexWrap: 'wrap',
                gap: 2,
                mb: 2,
                sx: {
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    backgroundColor: 'background.paper',
                    width: 'fit-content',
                },
            },
                h(MenuButton, {
                    variant: 'contained',
                    startIcon: h(PersonAdd),
                    items: [
                        { children: "user", onClick: () => setSel('new-user') },
                        { children: "group", onClick: () => setSel('new-group') },
                        { children: "from CSV", onClick: () => importAccountsCsv(reload) },
                    ]
                }, "Add"),
                reloadBtn(reload),
                list?.length! > 0 && h(Typography, { p: 1 }, `${list!.length} account(s)`),
            ) ),
        h(Grid, { item: true, md: 5 },
            !list?.length && h(Alert, { severity: 'info' }, md`To access administration <u>remotely</u> you will need to create a user account with admin permission`),
            h(TreeView<true>, { // true because it's not detecting multiSelect correctly (ts495)
                multiSelect: true,
                sx: { pr: 4, pb: 2, minWidth: '15em' },
                selected: selectionMode ? sel : [],
                onNodeSelect(ev, ids) {
                    setSel(ids)
                }
            },
                list?.map((ac: Account) =>
                    h(TreeItem, {
                        key: ac.username,
                        nodeId: ac.username,
                        label: h(Box, {
                            sx: {
                                display: 'flex',
                                flexWrap: 'wrap',
                                padding: '.2em 0',
                                gap: '.5em',
                                alignItems: 'center',
                            }
                        },
                            account2icon(ac),
                            ac.disabled && h(DoNotDisturb),
                            (ac.expire || ac.days_to_live) && h(Schedule),
                            ac.adminActualAccess && iconTooltip(MilitaryTech, "Can login into Admin"),
                            ac.username,
                            Boolean(ac.belongs?.length) && h(Box, { sx: { color: 'text.secondary', fontSize: 'small' } },
                                '(', ac.belongs?.join(', '), ')')
                        ),
                    })
                )
            )
        ),
        isSideBreakpoint && sideContent && h(Grid, { item: true, md: 7 },
            h(Card, {}, h(CardContent, {}, sideContent) )),
    )

    function selectNone() {
        setSel([])
    }

    async function deleteAccounts() {
        if (sel.length > _.pull(sel, username).length)
            if (!await confirmDialog(`Will delete the rest but not current account (${username})`)) return
        if (!sel.length) return
        if (!await confirmDialog(`Delete ${sel.length} item(s)?`)) return
        const errors = []
        for (const username of sel)
            if (!await apiCall('del_account', { username }).then(() => 1, () => 0))
                errors.push(username)
        reload()
        if (errors.length)
            return alertDialog("Following elements couldn't be deleted: " + errors.join(', '), 'error')
    }
}

export function account2icon(ac: Account, props={}) {
    return h(ac.hasPassword ? Person : Group, props)
}

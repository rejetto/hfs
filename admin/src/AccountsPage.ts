// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useState, useEffect, Fragment, useMemo } from "react"
import { apiCall, useApiEx } from './api'
import { Alert, Box, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Close, Delete, DoNotDisturb, Group, MilitaryTech, Person, PersonAdd, Schedule } from '@mui/icons-material'
import { newDialog, with_, md } from './misc'
import { Btn, Flex, IconBtn, iconTooltip, reloadBtn, useBreakpoint } from './mui'
import { TreeItem, TreeView } from '@mui/x-tree-view'
import MenuButton from './MenuButton'
import AccountForm from './AccountForm'
import _ from 'lodash'
import { alertDialog, confirmDialog, toast } from './dialog'
import { useSnapState } from './state'
import { importAccountsCsv } from './importAccountsCsv'
import apiAccounts from '../../src/api.accounts'

export type Account = ReturnType<typeof apiAccounts.get_accounts>['list'][0]

export default function AccountsPage() {
    const { username } = useSnapState()
    const { data, reload, element } = useApiEx<typeof apiAccounts.get_accounts>('get_accounts')
    const [sel, setSel] = useState<string[] | 'new-group' | 'new-user'>([])
    const selectionMode = Array.isArray(sel)
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (Array.isArray(data?.list) && selectionMode)
            setSel( sel.filter(u => data!.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [data]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    const list = useMemo(() => data && _.sortBy(data.list, ['hasPassword', x => !x.adminActualAccess, 'username']), [data])
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
            : with_(selectedAccount || newAccount(), a =>
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
                        setSel(isSideBreakpoint ? [username] : [])
                        reload()
                        toast("Account saved", 'success')
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
        return () => void close()
    }, [isSideBreakpoint, sel, selectedAccount])

    const scrollProps = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' } as const
    return element || h(Grid, { container: true, rowSpacing: 1, columnSpacing: 2, top: 0, flex: '1 1 auto', height: 0 },
        h(Grid, { item: true, xs: 12, [sideBreakpoint]: 5, lg: 4, xl: 5, ...scrollProps },
            h(Box, {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 2,
                    boxShadow: '0px -8px 4px 10px #111',
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
            ),
            !list?.length && h(Alert, { severity: 'info' }, md`To access administration <u>remotely</u> you will need to create a user account with admin permission`),
            h(TreeView<true>, { // true because it's not detecting multiSelect correctly (ts495)
                    multiSelect: true,
                    sx: { pr: 4, pb: 2, minWidth: '15em' },
                    selected: selectionMode ? sel : [],
                    onNodeSelect(ev, ids) {
                        setSel(ids)
                    }
                },
                list?.map(ac =>
                    h(TreeItem, {
                        key: ac.username,
                        nodeId: ac.username,
                        label: h(Box, {
                                sx: {
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    padding: '.2em 0',
                                    columnGap: '.5em',
                                    alignItems: 'center',
                                }
                            },
                            account2icon(ac),
                            (ac.disabled || ac.canLogin === false)
                                && iconTooltip(DoNotDisturb, ac.disabled ? "Disabled" : "Disabled by its groups", ac.disabled ? undefined : { color: 'text.secondary' }),
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
        isSideBreakpoint && sideContent && h(Grid, { item: true, [sideBreakpoint]: true, maxWidth: '100%', ...scrollProps },
            h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                h(CardContent, {}, sideContent)) )
    )

    function newAccount() {
        return {
            username: '',
            hasPassword: sel === 'new-user',
            adminActualAccess: false,
            invalidated: undefined,
            canLogin: true
        } satisfies Account
    }

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

    function account2icon(ac: Account, props={}) {
        return h(ac.hasPassword ? Person : Group, props)
    }
}
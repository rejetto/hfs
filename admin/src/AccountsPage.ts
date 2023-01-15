// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useState, useEffect, Fragment } from "react"
import { apiCall, useApiEx } from './api'
import { Alert, Box, Button, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Delete, Group, MilitaryTech, Person, PersonAdd, Refresh } from '@mui/icons-material'
import { alertDialog, confirmDialog } from './dialog'
import { iconTooltip, onlyTruthy } from './misc'
import { TreeItem, TreeView } from '@mui/lab'
import MenuButton from './MenuButton'
import AccountForm from './AccountForm'
import md from './md'

export interface Account {
    username: string
    hasPassword?: boolean
    admin?: boolean
    adminActualAccess?: boolean
    ignore_limits?: boolean
    redirect?: string
    belongs?: string[]
}

export default function AccountsPage() {
    const { data, reload, element } = useApiEx('get_accounts')
    const [sel, setSel] = useState<string[] | 'new-group' | 'new-user'>([])
    const selectionMode = Array.isArray(sel)
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (Array.isArray(data?.list) && selectionMode)
            setSel( sel.filter(u => data.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [data]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    if (element)
        return element
    const { list }: { list: Account[] } = data
    return h(Grid, { container: true, maxWidth: '80em' },
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
                        { children: "group", onClick: () => setSel('new-group') }
                    ]
                }, 'Add'),
                h(Button, {
                    disabled: !selectionMode || !sel.length,
                    startIcon: h(Delete),
                    async onClick(){
                        if (!selectionMode) return
                        if (!await confirmDialog(`You are going to delete ${sel.length} account(s)`))
                            return
                        const errors = onlyTruthy(await Promise.all(sel.map(username =>
                            apiCall('del_account', { username }).then(() => null, () => username) )))
                        if (errors.length)
                            return alertDialog(errors.length === sel.length ? "Request failed" : hList("Some accounts were not deleted", errors), 'error')
                        reload()
                    }
                }, "Remove"),
                h(Button, { onClick: reload, startIcon: h(Refresh) }, "Reload"),
                list.length > 0 && h(Typography, { p: 1 }, `${list.length} account(s)`),
            ) ),
        h(Grid, { item: true, md: 5 },
            !list.length && h(Alert, { severity: 'info' }, md`To access administration _remotely_ you will need to create a user account with admin permission`),
            h(TreeView, {
                multiSelect: true,
                sx: { pr: 4, pb: 2, minWidth: '15em' },
                selected: selectionMode ? sel : [],
                onNodeSelect(ev, ids) {
                    setSel(ids)
                }
            },
                list.map((ac: Account) =>
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
                            ac.adminActualAccess && iconTooltip(MilitaryTech, "Can login into Admin"),
                            ac.username,
                            Boolean(ac.belongs?.length) && h(Box, { sx: { color: 'text.secondary', fontSize: 'small' } },
                                '(', ac.belongs?.join(', '), ')')
                        ),
                    })
                )
            )
        ),
        sel.length > 0 // this clever test is true both when some accounts are selected and when we are in "new account" modes
        && h(Grid, { item: true, md: 7 },
            h(Card, {},
                h(CardContent, {},
                    selectionMode && sel.length > 1 ? h(Box, {},
                        h(Typography, {}, sel.length + " selected"),
                        h(List, {},
                            sel.map(username =>
                                h(ListItem, { key: username },
                                    h(ListItemText, {}, username))))
                    ) : h(AccountForm, {
                        account: selectionMode && list.find(x => x.username === sel[0])
                            || { username: '', hasPassword: sel === 'new-user' },
                        groups: list.filter(x => !x.hasPassword).map( x => x.username ),
                        close(){ setSel([]) },
                        done(username) {
                            setSel([username])
                            reload()
                        }
                    })
                )))
    )
}

function hList(heading: string, list: any[]) {
    return h(Fragment, {},
        heading>'' && h(Typography, {}, heading),
        h(List, {},
            list.map((text,key) =>
                h(ListItem, { key },
                    typeof text === 'string' ? h(ListItemText, {}, text) : text) ))
    )
}

export function account2icon(ac: Account, props={}) {
    return h(ac.hasPassword ? Person : Group, props)
}

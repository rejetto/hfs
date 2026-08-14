// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { t } from './i18n'
import { createElement as h, useState, useEffect, Fragment, useMemo, ReactNode } from "react"
import { apiCall, useApiEx } from './api'
import { Alert, Box, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import {
    AccountTree, ChevronRight, Close, Delete, DoNotDisturb, ExpandMore, Group, MilitaryTech, Person, PersonAdd, Schedule
} from '@mui/icons-material'
import { newDialog, with_, md, Jsonify } from './misc'
import { Btn, execDoneMessage, Flex, IconBtn, iconTooltip, reloadBtn, useBreakpoint, useToggleButton } from './mui'
import { TreeItem, SimpleTreeView } from '@mui/x-tree-view'
import MenuButton from './MenuButton'
import AccountForm from './AccountForm'
import _ from 'lodash'
import { alertDialog, confirmDialog } from './dialog'
import { state, useSnapState } from './state'
import { importAccountsCsv } from './importAccountsCsv'
import type apiAccounts from '../../src/api.accounts'

export type Account = Jsonify<ReturnType<typeof apiAccounts.get_accounts>['list'][0]>

const SEP = '\t'
const userFromItemId = (itemId?: string) => itemId?.split(SEP).at(-1)

export default function AccountsPage() {
    const { username, accountsAsTree } = useSnapState()
    const { data, reload, element } = useApiEx<typeof apiAccounts.get_accounts>('get_accounts')
    const [sel, setSel] = useState<string[] | 'new-group' | 'new-user'>([])
    const selectionMode = Array.isArray(sel)
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (Array.isArray(data?.list) && selectionMode)
            setSel( sel.filter(x => data!.list.find((e:any) => e?.username === userFromItemId(x))) ) // remove elements that don't exist anymore
    }, [data]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    const list = useMemo(() => data && _.sortBy(data.list, [x => !x.isGroup, x => !x.adminActualAccess, 'username']), [data])
    const selectedAccount = selectionMode && _.find(list, { username: userFromItemId(sel[0]) })
    const sideBreakpoint = 'md'
    const isSideBreakpoint = useBreakpoint(sideBreakpoint)

    const sideContent = !(sel.length > 0) || !list ? null // this clever test is true both when some accounts are selected and when we are in "new account" modes
        : selectionMode && sel.length > 1 ? h(Fragment, {},
                h(Flex, {},
                    h(Typography, {variant: 'h6'}, t('select_count', { n: sel.length })),
                    h(Btn, { onClick: deleteAccounts, icon: Delete }, t`Remove`),
                ),
                h(List, {},
                    _.uniq(sel.map(userFromItemId)).map(username =>
                        h(ListItem, { key: username },
                            h(ListItemText, {}, username))))
            )
            : with_(selectedAccount || newAccount(), a =>
                h(AccountForm, {
                    account: a,
                    groups: list.filter(x => x.isGroup).map(x => x.username),
                    addToBar: isSideBreakpoint && [
                        h(Box, { sx: { flex: 1 } }),
                        account2icon(a, { fontSize: 'large', sx: { p: 1 }}),
                        // not really useful, but users misled in thinking it's a dialog will find satisfaction in dismissing the form
                        h(IconBtn, {  icon: Close, title: t`Close`, onClick: selectNone }),
                    ],
                    reload,
                    done(username, saveBtn) {
                        setSel(isSideBreakpoint ? [username] : [])
                        reload()
                        execDoneMessage('', saveBtn)
                    }
                }))
    useEffect(() => {
        if (isSideBreakpoint || !sideContent || !sel.length) return
        const { close } = newDialog({
            title: _.isString(sel) ? _.startCase(sel)
                : sel.length > 1 ? t`Multiple selection`
                    : selectedAccount ? t(selectedAccount.isGroup ? "Group: " : "User: ") + selectedAccount.username
                        : '?', // never
            Content: () => sideContent,
            onClose(keepSelection) {
                if (!keepSelection)
                    selectNone()
            },
        })
        // effect cleanup replaces the dialog; only user dismissal should clear selection
        return () => void close(true)
    }, [isSideBreakpoint, sel, selectedAccount])

    const scrollProps = { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'auto' } as const
    const [showTree, showTreeBtn] = useToggleButton(t`Show tree`, t`Show list`, () => ({ icon: AccountTree }), accountsAsTree)
    state.accountsAsTree = showTree
    return element || h(Grid, { container: true, sx: { rowSpacing: 1, columnSpacing: 2, top: 0, flex: '1 1 auto', height: 0 } },
        h(Grid, { size: { xs: 12, [sideBreakpoint]: 5, lg: 4, xl: 5 } as any, sx: scrollProps },
            h(Box, {
                sx: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 2,
                    mb: 2,
                    boxShadow: theme => `0px -8px 4px 10px ${theme.palette.background.paper}`,
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
                        { children: t`user`, onClick: () => setSel('new-user') },
                        { children: t`group`, onClick: () => setSel('new-group') },
                        { children: t`from CSV`, onClick: () => importAccountsCsv(reload) },
                    ]
                }, t`Add`),
                reloadBtn(reload),
                showTreeBtn,
                list?.length! > 0 && h(Typography, { sx: { p: 1 } },
                    t('accounts_count', { n: list!.length })),
            ),
            !list?.length && h(Alert, { severity: 'info' }, md(t`remote_admin_account_required`)),
            h(SimpleTreeView<true>, { // true because it's not detecting multiSelect correctly (ts495)
                    multiSelect: true,
                    sx: { pr: 4, pb: 2, minWidth: '15em' },
                    selectedItems: selectionMode ? sel : [],
                    slots: {
                        collapseIcon: ExpandMore,
                        expandIcon: ChevronRight,
                    },
                    onSelectedItemsChange(ev, ids) {
                        if (!(ev?.target as any)?.closest?.('.MuiTreeItem-iconContainer')) // don't select if clicked the expansion button, mostly for mobile users
                            setSel(ids)
                    }
                },
                list && (function recur(thisLevel, prefixPath=''): ReactNode {
                    return thisLevel.map(ac =>
                        h(TreeItem, {
                            key: ac.username,
                            itemId: prefixPath + ac.username,
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
                                && iconTooltip(DoNotDisturb, ac.disabled ? t`Disabled` : t`Disabled by its groups`, ac.disabled ? undefined : { color: 'text.secondary' }),
                                (ac.expire || ac.days_to_live) && h(Schedule),
                                ac.adminActualAccess && iconTooltip(MilitaryTech, t`Can login into Admin`),
                                ac.username,
                                Boolean(ac.belongs?.length) && h(Box, { sx: { color: 'text.secondary', fontSize: 'small' } },
                                    '(', ac.belongs?.join(', '), ')')
                            ),
                        }, showTree && recur(list.filter(x => ac.directMembers?.includes(x.username)), prefixPath+ac.username+SEP)))
                })(showTree ? list.filter(ac => !list.some(x => x.members?.includes(ac.username))) : list)
            )
        ),
        isSideBreakpoint && sideContent && h(Grid, { size: 'grow', sx: { ...scrollProps, maxWidth: '100%' } },
            h(Card, { sx: { overflow: 'initial' } }, // overflow is incompatible with stickyBar
                h(CardContent, {}, sideContent)) )
    )

    function newAccount() {
        return {
            username: '',
            hasPassword: sel === 'new-user',
            adminActualAccess: false,
            invalidated: undefined,
            canLogin: true,
            canChangePassword: true,
            isGroup: sel === 'new-group',
            members: [],
            directMembers: [],
        } satisfies Account
    }

    function selectNone() {
        setSel([])
    }

    async function deleteAccounts() {
        if (typeof sel === 'string') return
        if (sel.some(x => userFromItemId(x) === username))
            if (!await confirmDialog(t`current_account_delete_warning`)) return
        const toDelete = _.without(_.uniq(sel.map(userFromItemId)), username)
        if (!toDelete.length)
            return alertDialog(t`Nothing to delete`, 'info')
        if (!await confirmDialog(t('delete_items', { n: toDelete.length }))) return
        const errors = []
        for (const username of toDelete)
            if (!await apiCall('del_account', { username }).then(() => 1, () => 0))
                errors.push(username)
        reload()
        if (errors.length)
            return alertDialog(t('items_delete_failed', { n: errors.length, list: errors.join(', ') }), 'error')
    }

}

function account2icon(account: Account, props={}) {
    return h(account.isGroup ? Group : Person, props)
}

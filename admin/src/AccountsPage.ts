// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { isValidElement, createElement as h, useState, useEffect, Fragment } from "react"
import { apiCall, useApi, useApiComp } from './api'
import { Box, Button, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Delete, Group, MilitaryTech, Person, PersonAdd, Refresh } from '@mui/icons-material'
import { BoolField, Form, MultiSelectField, SelectField, StringField } from './Form'
import { alertDialog, confirmDialog } from './dialog'
import { iconTooltip, isEqualLax, onlyTruthy } from './misc'
import { TreeItem, TreeView } from '@mui/lab'
import { makeStyles } from '@mui/styles'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'

const useStyles = makeStyles({
    label: {
        display: 'flex',
        gap: '.5em',
        lineHeight: '2em',
        alignItems: 'center',
    }
})

interface Account {
    username: string
    hasPassword?: boolean
    adminActualAccess?: boolean
    ignore_limits?: boolean
    redirect?: string
    belongs?: string[]
}

export default function AccountsPage() {
    const [res, reload] = useApiComp('get_accounts')
    const [sel, setSel] = useState<string[]>([])
    const [add, setAdd] = useState(false)
    const [config] = useApi('get_config', { only: ['admin_login'] }) // load values here and pass to AccountForm, to avoid unnecessary reloads
    const styles = useStyles()
    useEffect(() => { // if accounts are reloaded, review the selection to remove elements that don't exist anymore
        if (isValidElement(res) || !Array.isArray(res?.list)) return
        setSel( sel.filter(u => res.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [res]) //eslint-disable-line -- Don't fall for its suggestion to add `sel` here: we modify it and declaring it as a dependency would cause a logical loop
    if (isValidElement(res))
        return res
    const { list }: { list: Account[] } = res
    const account = add ? { username: '', hasPassword:true } : sel.length === 1 && list.find(x => x.username === sel[0])
    return h(Grid, { container: true, maxWidth: '50em' },
        h(Grid, { item: true, xs: 12 },
            h(Box, {
                display: 'flex',
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
                h(Button, {
                    variant: 'contained',
                    startIcon: h(PersonAdd),
                    onClick(){ setAdd(true) }
                }, "Add"),
                h(Button, {
                    disabled: !sel.length,
                    startIcon: h(Delete),
                    async onClick(){
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
                h(Typography, { p: 1 }, `${list.length} account(s)`),
            ) ),
        h(Grid, { item: true, md: 6 },
            h(TreeView, {
                multiSelect: true,
                sx: { pr: 4, minWidth: '15em' },
                selected: sel,
                onNodeSelect(ev, ids) {
                    setAdd(false)
                    setSel(ids)
                }
            },
                list.map((ac: Account) =>
                    h(TreeItem, {
                        key: ac.username,
                        nodeId: ac.username,
                        label: h('div', { className: styles.label },
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
        (add || sel.length > 0) && h(Grid, { item: true, md: 6 },
            h(Card, {},
                h(CardContent, {},
                    account ? h(AccountForm, {
                        account,
                        config,
                        groups: list.filter(x => !x.hasPassword).map( x => x.username ),
                        done(username) {
                            setAdd(false)
                            setSel([username])
                            reload()
                        }
                    }) : h(Box, {},
                        h(Typography, {}, sel.length + " selected"),
                        h(List, {},
                            sel.map(username =>
                                h(ListItem, { key: username },
                                    h(ListItemText, {}, username))))
                    )
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

function AccountForm({ account, done, groups, config }: { account: Account, groups: string[], done: (username: string)=>void, config: any }) {
    const [values, setValues] = useState<Account & { password?: string, password2?: string }>(account)
    const [belongsOptions, setBelongOptions] = useState<string[]>([])
    useEffect(() => {
        setValues(account)
        setBelongOptions(groups.filter(x => x !== account.username ))
    }, [JSON.stringify(account)]) //eslint-disable-line
    const add = !account.username
    const group = !values.hasPassword
    return h(Form, {
        values,
        set(v, { k }) {
            setValues({ ...values, [k]: v })
        },
        barSx: { width: 'initial', justifyContent: 'space-between' },
        addToBar: [ account2icon(values, { fontSize: 'large', sx: { p: 1 }}) ],
        fields: [
            add && { k: 'hasPassword', comp: SelectField, label: 'Account type', options: [{ value: true, label: 'Simple' }, { value: false, label: 'Group' }] },
            { k: 'username', label: group ? 'Group name' : undefined, autoComplete: 'off' },
            !group && { k: 'password', comp: StringField, md: 6, type: 'password', autoComplete: 'new-password', label: add ? 'Password' : 'Change password' },
            !group && { k: 'password2', comp: StringField, md: 6, type: 'password', autoComplete: 'off', label: 'Repeat password' },
            { k: 'ignore_limits', comp: BoolField,
                helperText: values.ignore_limits ? "Speed limits don't apply to this account" : "Speed limits apply to this account" },
            { k: 'admin', comp: BoolField, fromField: (v:boolean) => v||null, label: "Permission to access Admin interface",
                helperText: "It's THIS interface you are using right now."
                    + (config?.admin_login ? '' : " You are currently giving free access without login. You can require login in Configuration page."),
                ...account.adminActualAccess && { value: true, disabled: true, helperText: "This permission is inherited" },
            },
            { k: 'redirect', comp: StringField, helperText: "If you want this account to be redirected to a specific folder/address at login time" },
            { k: 'belongs', comp: MultiSelectField, label: "Inherits from", options: belongsOptions,
                helperText: "Options and permissions of the selected groups will be applied to this account. "
                    + (belongsOptions.length ? '' : "There are no groups available, create one first.") }
        ],
        save: {
            disabled: isEqualLax(values, account),
            async onClick() {
                const { username } = values
                if (!username)
                    return alertDialog(`Username cannot be empty`, 'warning')
                const { hasPassword, password, password2, ...withoutPassword } = values
                if (password !== password2)
                    return alertDialog("You entered 2 different passwords, please fix", 'error')
                try {
                    if (add) {
                        if (hasPassword && !password)
                            return alertDialog("Please provide a password", 'warning')
                        await apiCall('add_account', withoutPassword)
                        if (password)
                            try { await apiNewPassword(username, password) }
                            catch(e) {
                                apiCall('del_account', { username }).then() // best effort, don't wait
                                throw e
                            }
                        done(username)
                        return alertDialog("Account created", 'success')
                    }
                    await apiCall('set_account', {
                        username: account.username,
                        changes: withoutPassword,
                    })
                    if (password)
                        await apiNewPassword(username, password)
                    done(username)
                    return alertDialog("Account modified", 'success')
                }
                catch (e) {
                    return alertDialog(e as Error)
                }
            }
        }
    })
}

function account2icon(ac: Account, props={}) {
    return h(ac.hasPassword ? Person : Group, props)
}

async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp', { username, salt: String(res.s), verifier: String(res.v) }).catch(e => {
        if (e.code !== 406) // 406 = server was configured to support clear text authentication
            throw e
        return apiCall('change_password', { username, newPassword: password }) // unencrypted version
    })
}

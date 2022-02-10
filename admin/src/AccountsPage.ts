import { isValidElement, createElement as h, useState, useEffect, Fragment } from "react"
import { apiCall, useApiComp } from './api'
import { Box, Button, Card, CardContent, Grid, List, ListItem, ListItemText, Typography } from '@mui/material'
import { Delete, Group, Person, PersonAdd, Refresh } from '@mui/icons-material'
import { BoolField, Form, SelectField, StringField } from './Form'
import { alertDialog, confirmDialog } from './dialog'
import { isEqualLax, onlyTruthy } from './misc'
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
    ignore_limits?: boolean
    redirect?: string
}

export default function AccountsPage() {
    const [res, reload] = useApiComp('get_accounts')
    const [sel, setSel] = useState<string[]>([])
    const [add, setAdd] = useState(false)
    const styles = useStyles()
    useEffect(() => {
        if (isValidElement(res) || !Array.isArray(res?.list)) return
        setSel( sel.filter(u => res.list.find((e:any) => e?.username === u)) ) // remove elements that don't exist anymore
    }, [res])
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
                        label: h('div', { className: styles.label }, account2icon(ac), ac.username ),
                    })
                )
            )
        ),
        (add || sel.length > 0) && h(Grid, { item: true, md: 6 },
            h(Card, {},
                h(CardContent, {},
                    account ? h(AccountForm, {
                        account,
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

function AccountForm({ account, done, groups }: { account: Account, groups: string[], done: (username: string)=>void }) {
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
            { k: 'ignore_limits', comp: BoolField },
            { k: 'redirect', comp: StringField },
            { k: 'belongs', comp: SelectField, multiple: true, label: "Inherits from", options: belongsOptions }
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
                        return alertDialog("Account created")
                    }
                    await apiCall('set_account', {
                        username: account.username,
                        changes: withoutPassword,
                    })
                    if (password)
                        await apiNewPassword(username, password)
                    done(username)
                    return alertDialog("Account modified")
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

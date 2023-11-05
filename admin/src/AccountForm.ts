// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { BoolField, Form, MultiSelectField } from '@hfs/mui-grid-form'
import { Alert, Box } from '@mui/material'
import { apiCall } from './api'
import { alertDialog, toast, useDialogBarColors } from './dialog'
import { IconBtn, isEqualLax, modifiedSx, wantArray } from './misc'
import { Account, account2icon } from './AccountsPage'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { AutoDelete, Delete } from '@mui/icons-material'
import { isMobile } from './misc'

interface FormProps { account: Account, groups: string[], done: (username: string)=>void, reload: ()=>void, addToBar: ReactNode }
export default function AccountForm({ account, done, groups, addToBar, reload }: FormProps) {
    const [values, setValues] = useState<Account & { password?: string, password2?: string }>(account)
    const [belongsOptions, setBelongOptions] = useState<string[]>([])
    useEffect(() => {
        setValues(account)
        setBelongOptions(groups.filter(x => x !== account.username ))
        if (!isMobile())
            ref.current?.querySelector('input')?.focus()
    }, [JSON.stringify(account)]) //eslint-disable-line
    const add = !account.username
    const group = !values.hasPassword
    const ref = useRef<HTMLFormElement>()
    return h(Form, {
        formRef:  ref,
        values,
        set(v, k) {
            setValues(values => ({ ...values, [k]: v }))
        },
        barSx: { gap: 2, width: '100%', ...useDialogBarColors() },
        stickyBar: true,
        addToBar: [
            !add && h(IconBtn, {
                icon: Delete,
                title: "Delete",
                confirm: "Delete?",
                onClick: () => apiCall('del_account', { username: account.username }).then(reload)
            }),
            h(IconBtn, {
                icon: AutoDelete,
                title: "Invalidate past sessions",
                doneMessage: true,
                disabled: account.invalidated,
                onClick: () => apiCall('invalidate_sessions', { username: account.username }).then(reload)
            }),
            ...wantArray(addToBar),
        ],
        fields: [
            { k: 'username', label: group ? 'Group name' : undefined, autoComplete: 'off', required: true, xl: group ? 12 : 4,
                getError: v => v !== account.username && apiCall('get_account', { username: v })
                    .then(got => got?.username === account.username ? "usernames are case-insensitive" : "already used", () => false),
            },
            !group && { k: 'password', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', required: add,
                label: add ? "Password" : "Change password"
            },
            !group && { k: 'password2', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', label: 'Repeat password',
                getError: (x, { values }) => (x||'') !== (values.password||'') && "Enter same password" },
            { k: 'disabled', comp: BoolField, fromField: x=>!x, toField: x=>!x, label: "Enabled", xs: 12, sm: 6, xl: 8,
                helperText: "Login is prevented if account is disabled, or if all its groups are disabled"},
            { k: 'ignore_limits', comp: BoolField, xs: 'auto',
                helperText: values.ignore_limits ? "Speed limits don't apply to this account" : "Speed limits apply to this account" },
            { k: 'admin', comp: BoolField, fromField: (v:boolean) => v||null, label: "Admin-panel access", xs: 12, sm: 6, xl: 8,
                helperText: "To access THIS interface you are using right now",
                ...!account.admin && account.adminActualAccess && { value: true, helperText: "This permission is inherited" },
            },
            { k: 'disable_password_change', comp: BoolField, fromField: x=>!x, toField: x=>!x, label: "Allow password change", xs: 'auto' },
            group && h(Alert, { severity: 'info' }, `To add users to this group, select the user and then click "Inherit"`),
            { k: 'belongs', comp: MultiSelectField, label: "Inherit from groups", options: belongsOptions,
                helperText: "Specify groups to inherit permissions from"
                    + (!group ? '' : ". A group can inherit from another group")
                    + (belongsOptions.length ? '' : ". Now disabled because there are no groups to select, create one first.")
            },
            { k: 'redirect', helperText: "If you want this account to be redirected to a specific folder/address at login time" },
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx( !isEqualLax(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, hasPassword, ...withoutPassword } = values
                const { username } = values
                if (add) {
                    const got = await apiCall('add_account', withoutPassword)
                    if (password)
                        try { await apiNewPassword(username, password) }
                        catch(e) {
                            apiCall('del_account', { username }).then() // best effort, don't wait
                            throw e
                        }
                    done(got?.username)
                    toast("Account created", 'success')
                    return
                }
                const got = await apiCall('set_account', {
                    username: account.username,
                    changes: withoutPassword,
                })
                if (password)
                    await apiNewPassword(username, password)
                setTimeout(() => toast("Account modified", 'success'), 1) // workaround: showing a dialog at this point is causing a crash if we are in a dialog
                done(got?.username) // username may have been changed, so we pass it back
            }
        }
    })
}

export async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp_others', { username, salt: String(res.s), verifier: String(res.v) }).catch(e => {
        if (e.code !== 406) // 406 = server was configured to support clear text authentication
            throw e
        return apiCall('change_password_others', { username, newPassword: password }) // unencrypted version
    })
}

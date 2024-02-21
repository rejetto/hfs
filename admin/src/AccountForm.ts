// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { BoolField, Form, MultiSelectField, NumberField } from '@hfs/mui-grid-form'
import { Alert } from '@mui/material'
import { apiCall } from './api'
import { alertDialog, toast, useDialogBarColors } from './dialog'
import { isEqualLax, wantArray } from './misc'
import { IconBtn, modifiedProps } from './mui'
import { Account } from './AccountsPage'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { AutoDelete, Delete } from '@mui/icons-material'
import { isMobile } from './misc'
import { state, useSnapState } from './state'
import VfsPathField from './VfsPathField'
import { DateTimeField } from './DateTimeField'

interface FormProps { account: Account, groups: string[], done: (username: string)=>void, reload: ()=>void, addToBar: ReactNode }
export default function AccountForm({ account, done, groups, addToBar, reload }: FormProps) {
    const { username } = useSnapState()
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
    const expired = Boolean(values.expire)
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
                ...username === account.username && { disabled: true, title: "Cannot delete current account" },
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
            { k: 'expire', label: "Expiration", xs: true, comp: DateTimeField, toField: x => x && new Date(x),
                helperText: "When expired, login won't be allowed" },
            { k: 'days_to_live', xs: 12, sm: 6, comp: NumberField, disabled: expired, step: 'any', min: 1/1000, // 10 minutes
                helperText: "Used to set expiration on first login" + (expired ? " (already expired)" : '') },
            { k: 'redirect', comp: VfsPathField, onlyFolders: false, placeholder: "no",
                helperText: "If you want this account to be redirected to a specific folder/address (or even file) at login time" },
        ],
        onError: alertDialog,
        save: {
            ...modifiedProps( !isEqualLax(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, hasPassword, invalidated, ...withoutPassword } = values
                if (add) {
                    const got = await apiCall('add_account', withoutPassword)
                    if (password)
                        try { await apiNewPassword(values.username, password) }
                        catch(e) {
                            apiCall('del_account', { username: values.username }).then() // best effort, don't wait
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
                    await apiNewPassword(values.username, password)
                if (account.username === username)
                    state.username = values.username
                setTimeout(() => toast("Account modified", 'success'), 1) // workaround: showing a dialog at this point is causing a crash if we are in a dialog
                done(got?.username) // username may have been changed, so we pass it back
            }
        }
    })
}

export async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp', { username, salt: String(res.s), verifier: String(res.v) })
}

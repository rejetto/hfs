// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { BoolField, Form, MultiSelectField, NumberField, SelectField } from '@hfs/mui-grid-form'
import { Alert, Box } from '@mui/material'
import { apiCall } from './api'
import { alertDialog, useDialogBarColors } from './dialog'
import { formatTimestamp, isEqualLax, prefix, reactJoin, useIsMobile, wantArray } from './misc'
import { Btn, Flex, IconBtn, NetmaskField, propsForModifiedValues, useLogBreakpoint } from './mui'
import { Account } from './AccountsPage'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { AutoDelete, Delete } from '@mui/icons-material'
import { state, useSnapState } from './state'
import VfsPathField from './VfsPathField'
import { DateTimeField } from './DateTimeField'

interface FormProps { account: Account, groups: string[], done: (username: string)=>void, reload: ()=>void, addToBar: ReactNode }
export default function AccountForm({ account, done, groups, addToBar, reload }: FormProps) {
    const { username } = useSnapState()
    const [values, setValues] = useState<Account & { password?: string, password2?: string }>(account)
    const [belongsOptions, setBelongOptions] = useState<string[]>([])
    const isMobile = useIsMobile()
    useEffect(() => {
        setValues(account)
        setBelongOptions(groups.filter(x => x !== account.username ))
        if (!isMobile)
            ref.current?.querySelector('input')?.focus()
    }, [JSON.stringify(account)]) //eslint-disable-line
    const add = !account.username
    const { isGroup } = values
    const ref = useRef<HTMLFormElement>()
    const { members } = account
    const pluginAuth = account.plugin?.auth
    return h(Form, {
        formRef: ref,
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
                confirm: `Delete ${account.username}?`,
                ...username === account.username && { disabled: true, title: "Cannot delete current account" },
                onClick: () => apiCall('del_account', { username: account.username }).then(reload)
            }),
            h(IconBtn, {
                icon: AutoDelete,
                title: `Invalidate past sessions${prefix('\n(already invalidated sessions before ', formatTimestamp(account.invalidated || 0), ')')}`,
                confirm: `Invalidate all sessions up to now for "${account.username}"?`,
                doneMessage: true,
                onClick: () => apiCall('invalidate_sessions', { username: account.username }).then(reload)
            }),
            ...wantArray(addToBar),
        ],
        fields: [
            { k: 'username', label: isGroup ? 'Group name' : undefined, autoComplete: 'off', required: true, md: isGroup && !pluginAuth ? 12 : 4,
                getError: v => v !== account.username && apiCall('get_account', { username: v })
                    .then(got => got?.username === account.username ? "usernames are case-insensitive" : "already used", () => false),
            },
            pluginAuth && { k: '', md: 8, comp: h(Alert, { severity: 'info' }, " Authentication handled by a plugin") },
            !isGroup && !pluginAuth && { k: 'password', xs: 6, md: 4, type: 'password', autoComplete: 'new-password', required: add,
                label: add ? "Password" : "Change password"
            },
            !isGroup && !pluginAuth && { k: 'password2', xs: 6, md: 4, type: 'password', autoComplete: 'new-password', label: 'Repeat password',
                getError: (x, { values }) => (x||'') !== (values.password||'') && "Enter same password" },

            { k: 'disabled', comp: BoolField, fromField: x=>!x, toField: x=>!x, label: "Enabled", xs: 12, sm: 6, lg: 4,
                helperText:  values.disabled || values.canLogin !== false ? "Login is prevented if account is disabled, or all its groups are disabled"
                    : h(Box, { color: 'warning.main', component: 'span' },
                        new Date(account.expire!) < new Date() ? "Login is prevented because account is expired" // use account instead of values, so to use the value currently applied
                            : "Login is prevented because all of its groups are disabled")
            },
            { k: 'ignore_limits', comp: BoolField, xs: 12, sm: 6, lg: 4,
                helperText: values.ignore_limits ? "Speed limits don't apply to this account" : "Speed limits apply to this account" },
            { k: 'admin', comp: BoolField, fromField: (v:boolean) => v||null, label: "Admin-panel access", xs: 12, sm: 6, lg: 4,
                helperText: "To access THIS interface you are using right now",
                ...!account.admin && account.adminActualAccess && { value: true, disabled: true, helperText: "This permission is inherited. To disable it, act on the groups." },
            },
            !isGroup && { k: 'require_password_change', comp: BoolField, xs: 12, sm: 6, lg: 6, helperText: "At next login" },

            { k: 'disable_password_change', label: "Password change", comp: SelectField, xs: 12, sm: 6, lg: isGroup ? 4 : 6,
                defaultValue: null,
                options: { [`Default (${values.canChangePassword ? 'Allowed' : 'Disabled'})`]: null, "Allowed": false, "Disabled": true },
            },

            !members ? null
                : isGroup && !members.length ? h(Box, {}, "No members")
                    : members.length > 0 && h(Flex, { gap: 0, flexWrap: 'wrap' }, `${members.length} members: `,
                        reactJoin(', ', account.members?.map(u => h(groups.includes(u) ? 'i' : 'span', {}, u))),
                        h(Btn, {
                            icon: Delete,
                            confirm: `Delete ${account.members.length} accounts?`,
                            onClick: () => apiCall('del_account', { username: account.members }).then(reload),
                            sx: { verticalAlign: 'text-top' }
                        }),
                ),
            isGroup && h(Alert, { severity: 'info' }, `To add users to this group, select the user and then click "Inherit"`),
            { k: 'belongs', comp: MultiSelectField, label: "Inherit from groups", options: belongsOptions, sm: 6,
                helperText: "Specify groups to inherit permissions from"
                    + (!isGroup ? '' : ". A group can inherit from another group")
                    + (belongsOptions.length ? '' : ". Now disabled because there are no groups to select, create one first.")
            },
            { k: 'allow_net', comp: NetmaskField, label: "Allowed network address", sm: 6, placeholder: "Allow from any address" },
            { k: 'expire', label: "Expiration", xs: values.expire ? 12 : 6, comp: DateTimeField, toField: x => x && new Date(x),
                helperText: "When expired, login won't be allowed" },
            !values.expire && { k: 'days_to_live', xs: 12, sm: 6, comp: NumberField, step: 'any', min: 1/1000, // 10 minutes
                helperText: "Used to set expiration on first login" },
            { k: 'redirect', comp: VfsPathField, placeholder: "no", sm: 6,
                helperText: "If you want this account to be redirected to a specific folder/address (or even file) at login time" },
            { k: 'notes', multiline: true, sm: 6 },
        ],
        onError: alertDialog,
        save: {
            ...propsForModifiedValues(isModifiedConfig(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, hasPassword, invalidated, canLogin, members, ...withoutPassword } = values
                if (add) {
                    const got = await apiCall('add_account', withoutPassword)
                    if (password)
                        try { await apiNewPassword(values.username, password) }
                        catch(e) {
                            void apiCall('del_account', { username: values.username }) // best effort, don't wait
                            throw e
                        }
                    done(got?.username)
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
                done(got?.username) // username may have been changed, so we pass it back
            }
        }
    })
}

export function isModifiedConfig(a: any, b: any) {
    return !isEqualLax(a, b, (a,b) => !a && !b || undefined)
}

// you can set password directly in add/set_account, but using this api instead will add extra security because it is not sent as clear-text, so it's especially good if you are not in localhost and not using https
export async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp', { username, salt: String(res.s), verifier: String(res.v) })
}

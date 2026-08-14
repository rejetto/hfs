// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactNode, useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { BoolField, Form, MultiSelectField, NumberField, SelectField } from '@hfs/mui-grid-form'
import { Alert, Box } from '@mui/material'
import { apiCall } from './api'
import { alertDialog, useDialogBarColors } from './dialog'
import { apiNewPassword, formatTimestamp, isModifiedConfig, prefix, reactJoin, useIsMobile, wantArray } from './misc'
import { Btn, Flex, IconBtn, NetmaskField, propsForModifiedValues } from './mui'
import { type Account } from './AccountsPage'
import { AutoDelete, Delete } from '@mui/icons-material'
import { state, useSnapState } from './state'
import VfsPathField from './VfsPathField'
import { DateTimeField } from './DateTimeField'

export default function AccountForm({ account, done, groups, addToBar, reload }: {
    account: Account,
    groups: string[],
    done: (username: string, saveBtn?: HTMLButtonElement) => void,
    reload: () => void,
    addToBar: ReactNode
}) {
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
        key: account.username, // remount on account changes because Form owns validation state for the current record
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
                title: t`Delete`,
                confirm: t("Delete {username}?", { username: account.username }),
                ...username === account.username && { disabled: true, title: t`Cannot delete current account` },
                onClick: () => apiCall('del_account', { username: account.username }).then(reload)
            }),
            h(IconBtn, {
                icon: AutoDelete,
                title: t`Invalidate past sessions`
                    + (account.invalidated ? '\n' + t("(already invalidated sessions before {timestamp})", { timestamp: formatTimestamp(account.invalidated) }) : ''),
                confirm: t("Invalidate all sessions up to now for \"{username}\"?", { username: account.username }),
                doneMessage: true,
                onClick: () => apiCall('invalidate_sessions', { username: account.username }).then(reload)
            }),
            ...wantArray(addToBar),
        ],
        fields: [
            { k: 'username', label: t(isGroup ? "Group name" : "Username"), autoComplete: 'off', required: true, md: isGroup && !pluginAuth ? 12 : 4,
                getError: v => v !== account.username && apiCall('get_account', { username: v })
                    .then(got => got?.username === account.username ? t`usernames are case-insensitive` : t`already used`, () => false),
            },
            pluginAuth && { k: '', md: 8, comp: h(Alert, { severity: 'info' }, t`Authentication handled by a plugin`) },
            !isGroup && !pluginAuth && { k: 'password', xs: 6, md: 4, type: 'password', autoComplete: 'new-password', required: add,
                label: add ? t`Password` : t`Change password`
            },
            !isGroup && !pluginAuth && { k: 'password2', xs: 6, md: 4, type: 'password', autoComplete: 'new-password', label: t`Repeat password`,
                getError: (x, { values }) => (x||'') !== (values.password||'') && t`Enter same password` },

            { k: 'disabled', comp: BoolField, fromField: x=>!x, toField: x=>!x, label: t`Enabled`, xs: 12, sm: 6, lg: 4,
                helperText:  values.disabled || values.canLogin !== false ? t`login_disabled_by_account_or_groups`
                    : h(Box, { sx: { color: 'warning.main' }, component: 'span' } as any, // Box.component has ts problems with h()
                        new Date(account.expire!) < new Date() ? t`Login is prevented because account is expired` // use account instead of values, so to use the value currently applied
                            : t`login_disabled_by_groups`)
            },
            { k: 'ignore_limits', label: t`Ignore limits`, comp: BoolField, xs: 12, sm: 6, lg: 4,
                helperText: values.ignore_limits ? t`Speed limits don't apply to this account` : t`Speed limits apply to this account` },
            { k: 'admin', comp: BoolField, fromField: (v:boolean) => v||null, label: t`Admin-panel access`, xs: 12, sm: 6, lg: 4,
                helperText: t`To access THIS interface you are using right now`,
                ...!account.admin && account.adminActualAccess && { value: true, disabled: true, helperText: t`inherited_permission_notice` },
            },

            !isGroup && { k: 'require_password_change', label: t`Require password change`, comp: BoolField, xs: 12, sm: 6, lg: 4, helperText: t`At next login, but can be dismissed` },
            { k: 'disable_password_change', label: t`Password change`, comp: SelectField, xs: 12, sm: 6, lg: isGroup ? 4 : 4,
                defaultValue: null,
                options: { [t('default_setting', { defaultValue: t(values.canChangePassword ? "Allowed" : "Disabled") })]: null, [t`Allowed`]: false, [t`Disabled`]: true },
            },

            !members ? null
                : isGroup && !members.length ? h(Box, {}, t`No members`)
                    : members.length > 0 && h(Flex, { gap: 0, flexWrap: 'wrap' }, t('members_count', { n: members.length }),
                        reactJoin(', ', account.members?.map(u => h(groups.includes(u) ? 'i' : 'span', {}, u))),
                        h(Btn, {
                            icon: Delete,
                            confirm: t('delete_items', { n: account.members.length }),
                            onClick: () => apiCall('del_account', { username: account.members }).then(reload),
                            sx: { verticalAlign: 'text-top' }
                        }),
                ),
            isGroup && h(Alert, { severity: 'info' }, t`group_add_members_hint`),
            { k: 'belongs', comp: MultiSelectField, label: t`Inherit from groups`, options: belongsOptions, sm: 6, lg: 4,
                helperText: [
                    t`Specify groups to inherit permissions from.`,
                    isGroup && t`A group can inherit from another group.`,
                    !belongsOptions.length && t`no_groups_available`,
                ].filter(Boolean).join(' ')
            },

            { k: 'allow_net', comp: NetmaskField, label: t`Allowed network address`, sm: 6, lg: 4, placeholder: t`any address` },
            !isGroup && { k: 'auto_login_net', comp: NetmaskField, label: t`Auto-login by IP address`, sm: 6, lg: 4, placeholder: t`none` },
            { k: 'redirect', label: t`Redirect`, comp: VfsPathField, placeholder: t`no`, sm: 6, lg: 4,
                helperText: t`account_redirect_hint` },

            { k: 'expire', label: t`Expiration`, sm: 6, lg: 4, comp: DateTimeField, toField: x => x && new Date(x),
                helperText: t`When expired, login won't be allowed` },
            { k: 'days_to_live', label: t`Days to live`, sm: 6, lg: 4, comp: NumberField, step: 'any', min: 1/1000, // 10 minutes
                ...values.expire && { xs: 12, disabled: true, sx: { opacity: .2 } }, helperText: t`Used to set expiration on first login` },
            { k: 'notes', label: t`Notes`, multiline: true, sm: 6, lg: 4 },
        ],
        onError: alertDialog,
        save: {
            children: t`Save`,
            ...propsForModifiedValues(isModifiedConfig(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, hasPassword, invalidated, canLogin, members, ...withoutPassword } = values
                const saveBtn = ref.current?.querySelector<HTMLButtonElement>('button.saveBtn') || undefined
                if (add) {
                    const got = await apiCall('add_account', withoutPassword)
                    if (password)
                        try { await apiNewPassword(values.username, password) }
                        catch(e) {
                            void apiCall('del_account', { username: values.username }) // best effort, don't wait
                            throw e
                        }
                    done(got?.username, saveBtn)
                    return
                }
                const got = await apiCall('set_account', {
                    username: account.username,
                    changes: withoutPassword,
                })
                if (password) {
                    await apiNewPassword(values.username, password)
                    setValues(values => ({ ...values, password: '', password2: '' }))
                }
                if (account.username === username)
                    state.username = got.username // use the server's normalized name for current-account checks
                done(got?.username, saveBtn) // username may have been changed, so we pass it back
            }
        }
    })
}

import { createElement as h, useEffect, useRef, useState } from 'react'
import { BoolField, Form, MultiSelectField } from '@hfs/mui-grid-form'
import { Box, Button } from '@mui/material'
import { apiCall } from './api'
import { alertDialog } from './dialog'
import { isEqualLax, modifiedSx } from './misc'
import { Account, account2icon } from './AccountsPage'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'

interface FormProps { account: Account, groups: string[], done: (username: string)=>void, close: ()=>void }
export default function AccountForm({ account, done, groups, close }: FormProps) {
    const [values, setValues] = useState<Account & { password?: string, password2?: string }>(account)
    const [belongsOptions, setBelongOptions] = useState<string[]>([])
    useEffect(() => {
        setValues(account)
        setBelongOptions(groups.filter(x => x !== account.username ))
        ref.current?.querySelector('input')?.focus()
    }, [JSON.stringify(account)]) //eslint-disable-line
    const add = !account.username
    const group = !values.hasPassword
    const ref = useRef<HTMLFormElement>()
    return h(Form, {
        formRef:  ref,
        values,
        set(v, k) {
            setValues({ ...values, [k]: v })
        },
        addToBar: [
            h(Button, { onClick: close, sx: { ml: 2 } }, "Close"),
            h(Box, { flex:1 }),
            account2icon(values, { fontSize: 'large', sx: { p: 1 }})
        ],
        fields: [
            { k: 'username', label: group ? 'Group name' : undefined, autoComplete: 'off', required: true, xl: group ? 12 : 4,
                getError: v => v !== account.username && apiCall('get_account', { username: v }).then(() => "already used", () => false),
            },
            !group && { k: 'password', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', required: add,
                label: add ? "Password" : "Change password"
            },
            !group && { k: 'password2', md: 6, xl: 4, type: 'password', autoComplete: 'new-password', label: 'Repeat password',
                getError: (x, { values }) => (x||'') !== (values.password||'') && "Enter same password" },
            { k: 'ignore_limits', comp: BoolField, xl: 6,
                helperText: values.ignore_limits ? "Speed limits don't apply to this account" : "Speed limits apply to this account" },
            { k: 'admin', comp: BoolField, xl: 6, fromField: (v:boolean) => v||null, label: "Permission to access Admin interface",
                helperText: "To access THIS interface you are using right now",
                ...account.adminActualAccess && { value: true, disabled: true, helperText: "This permission is inherited" },
            },
            { k: 'belongs', comp: MultiSelectField, label: "Inherits from", options: belongsOptions,
                helperText: "Specify groups to inherit permissions from."
                    + (belongsOptions.length ? '' : " There are no groups available, create one first.")
            },
            { k: 'redirect', helperText: "If you want this account to be redirected to a specific folder/address at login time" },
        ],
        onError: alertDialog,
        save: {
            sx: modifiedSx( !isEqualLax(values, account)),
            async onClick() {
                const { password='', password2, adminActualAccess, ...withoutPassword } = values
                const { username } = values
                if (add) {
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
        }
    })
}

async function apiNewPassword(username: string, password: string) {
    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const res = await createVerifierAndSalt(srp6aNimbusRoutines, username, password)
    return apiCall('change_srp_others', { username, salt: String(res.s), verifier: String(res.v) }).catch(e => {
        if (e.code !== 406) // 406 = server was configured to support clear text authentication
            throw e
        return apiCall('change_password_others', { username, newPassword: password }) // unencrypted version
    })
}

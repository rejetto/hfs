// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useSnapState } from './state'
import { createElement as h } from 'react'
import { alertDialog, closeDialog, newDialog, promptDialog } from './dialog'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { apiCall } from '@hfs/shared/api'
import { logout } from './login'
import { Btn, CustomCode } from './components'
import { formatTimestamp, hIcon, fallbackToBasicAuth, working } from './misc'
import { t } from './i18n'

export default function showUserPanel() {
    const { close } = newDialog({
        title: t`User panel`,
        className: 'user-dialog',
        icon: () => hIcon('user'),
        Content() {
            const snap = useSnapState()
            return h('div', { id: 'user-panel' },
                h('div', {}, t`Username`, ': ', snap.username),
                snap.accountExp && h('div', {}, t`Account expiration`, ': ', formatTimestamp(snap.accountExp)),
                h(CustomCode, { name: 'userPanelAfterInfo' }),
                snap.canChangePassword && !fallbackToBasicAuth() && h(Btn, {
                    icon: 'password',
                    label: t`Change password`,
                    id: 'change-password',
                    onClickAnimation: false,
                    async onClick() {
                        const pwd = await promptDialog(t('enter_pass', "Enter new password"), { type: 'password' })
                        if (!pwd) return
                        const check = await promptDialog(t('enter_pass2', "RE-enter same new password"), { type: 'password' })
                        if (!check) return
                        if (check !== pwd)
                            return alertDialog(t('pass2_mismatch', "The second password you entered did not match the first. Procedure aborted."), 'warning')
                        const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
                        const res = await createVerifierAndSalt(srp6aNimbusRoutines, snap.username, pwd)
                        try {
                            await apiCall('change_my_srp', { salt: String(res.s), verifier: String(res.v) }, { modal: working })
                            return alertDialog(t('password_changed', "Password changed"))
                        }
                        catch(e) {
                            return alertDialog(e as Error)
                        }
                    }
                }),
                h(Btn, {
                    icon: 'logout',
                    label: t`Logout`,
                    id: 'logout',
                    onClick() {
                        if (fallbackToBasicAuth()) // this is effective on ff52, but not on chrome125
                            return location.href = `//LOGOUT%00:@${location.host}/?get=logout` // redirect, to execute the body content
                        logout().then(close, alertDialog)
                    }
                })
            )
        }
    })
}

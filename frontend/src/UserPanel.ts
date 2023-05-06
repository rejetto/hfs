// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useSnapState } from './state'
import { createElement as h } from 'react'
import { alertDialog, closeDialog, newDialog, promptDialog } from './dialog'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { apiCall } from '@hfs/shared/api'
import { logout } from './login'
import { MenuButton } from './menu'
import { hIcon } from './misc'
import { t } from './i18n'

export default function showUserPanel() {
    newDialog({
        title: t`User panel`,
        className: 'user-dialog',
        icon: () => hIcon('user'),
        Content() {
            const snap = useSnapState()
            return h('div', { id: 'user-panel' },
                h('div', {}, t`Username`, ': ', snap.username),
                h(MenuButton, {
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
                            await apiCall('change_srp', { salt: String(res.s), verifier: String(res.v) }).catch(e => {
                                if (e.code !== 406) // 406 = server was configured to support clear text authentication
                                    throw e
                                return apiCall('change_password', { newPassword: pwd }) // unencrypted version
                            })
                            return alertDialog(t('password_changed', "Password changed"))
                        }
                        catch(e) {
                            return alertDialog(e as Error)
                        }
                    }
                }),
                h(MenuButton, {
                    icon: 'logout',
                    label: t`Logout`,
                    id: 'logout',
                    onClick() {
                        logout().then(closeDialog, alertDialog)
                    }
                })
            )
        }
    })
}

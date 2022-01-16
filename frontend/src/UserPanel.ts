import { useSnapState } from './state'
import { createElement as h } from 'react'
import { alertDialog, closeDialog, newDialog, promptDialog } from './dialog'
import { createVerifierAndSalt, SRPParameters, SRPRoutines } from 'tssrp6a'
import { apiCall } from './api'
import { logout } from './login'
import { MenuButton } from './menu'

export default function showUserPanel() {
    newDialog({ Content })
}

function Content() {
    const snap = useSnapState()
    return h('div', { id: 'user-panel' },
        h('div', {}, 'User: ' + snap.username),
        h(MenuButton, {
            icon: 'password',
            label: 'Change password',
            async onClick() {
                const pwd = await promptDialog('Enter new password', { type: 'password' })
                if (!pwd) return
                const check = await promptDialog('RE-enter new password', { type: 'password' })
                if (!check) return
                if (check !== pwd)
                    return alertDialog('The second password you entered did not match the first. Procedure aborted.', 'warning')
                const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
                const res = await createVerifierAndSalt(srp6aNimbusRoutines, snap.username, pwd)
                await apiCall('change_srp', { salt: String(res.s), verifier: String(res.v) }).catch(e => {
                    if (e.code !== 406) // 406 = server was configured to support clear text authentication
                        throw e
                    return apiCall('change_password', { newPassword: pwd }) // unencrypted version
                })
                return alertDialog('Password changed')
            }
        }),
        h(MenuButton, {
            icon: 'logout',
            label: 'Logout',
            onClick() {
                logout().then(closeDialog)
            }
        })
    )
}

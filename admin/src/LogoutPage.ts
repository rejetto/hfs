// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from "react"
import { Alert, Box } from '@mui/material'
import { apiCall, useApiEx } from './api'
import { alertDialog } from "./dialog"
import { useSnapState } from './state'
import { HTTP_UNAUTHORIZED } from './misc'
import { Logout, PowerSettingsNew } from '@mui/icons-material'
import { Btn } from './mui'

export default function LogoutPage() {
    const { element } = useApiEx('get_config', { only: [] }) // sort of noop, just to get the 'element' part
    const { username } = useSnapState()
    if (element)
        return element
    return h(Box, { display: 'flex', flexDirection:'column', alignItems: 'flex-start', gap: 2 },
        !username ? h(Alert, { severity: 'info' }, "You are not logged in, because authentication is not required on localhost")
            : h(Fragment, {},
                "You are logged in as: " + username,
                h(Btn, {
                    icon: Logout,
                    size: 'large',
                    onClick: () => apiCall('logout').catch(err => // we expect 401
                            err.code !== HTTP_UNAUTHORIZED && alertDialog(err))
                }, "I want to logout")
            ),
        h(Btn, {
            icon: PowerSettingsNew,
            size: 'large',
            color: 'warning',
            confirm: "Stopping the server, this interface won't respond anymore",
            async onClick() {
                await apiCall('quit')
                await alertDialog("Good-bye", 'success')
                location.reload()
            },
        }, "Quit HFS")
    )
}

import { createElement as h } from "react"
import { Alert, Box, Button } from '@mui/material'
import { apiCall, useApiEx } from './api'
import { alertDialog } from "./dialog"
import { useSnapState } from './state'

export default function LogoutPage() {
    const { element } = useApiEx('get_config', { only: [] }) // sort of noop, just to get the 'element' part
    const { username } = useSnapState()
    if (element)
        return element
    if (!username)
        return h(Alert, { severity: 'info' }, "You are not logged in, because authentication is not required on localhost")
    return h(Box, { display: 'flex', flexDirection:'column', gap: 2 },
        "You are logged in as " + username,
        h(Box, {},
            h(Button, {
                size: 'large',
                variant: 'contained',
                onClick() {
                    apiCall('logout').catch(err => // we expect 401
                        err.code !== 401 && alertDialog(err))
                }
            }, "Yes, I want to logout")
        )
    )
}

import { createElement as h } from "react"
import { Alert, Box, Button } from '@mui/material'
import { apiCall, useApi } from './api'
import { alertDialog } from "./dialog"
import { useSnapState } from './state'

export default function LogoutPage() {
    const [cfg] = useApi('get_config', { only: [] })
    const { username } = useSnapState()
    if (!cfg) return null
    if (!username)
        return h(Alert, { severity: 'info' }, "You are not logged in, because authentication is not required on localhost")
    return h(Box, { display: 'flex', flexDirection:'column', gap: 2 },
        "You are logged in as " + username,
        h(Box, {},
            h(Button, {
                size: 'large',
                variant: 'contained',
                onClick() {
                    apiCall('logout').then(() =>
                            apiCall('get_status').catch(()=>0), // second call is supposed to trigger a 401 if login is required
                        alertDialog) // show errors
                }
            }, "Yes, I want to logout")
        )
    )
}

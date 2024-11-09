// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { CFG, HTTP_FORBIDDEN, HTTP_UNAUTHORIZED, makeSessionRefresher } from './misc'
import { BoolField, Form } from '@hfs/mui-grid-form'
import { apiCall } from './api'
import { srpClientSequence } from '@hfs/shared'
import { Alert, Box } from '@mui/material'
import { Center } from './mui'

export function LoginRequired({ children }: any) {
    const { loginRequired } = useSnapState()
    if (loginRequired === HTTP_FORBIDDEN)
        return h(Center, {},
            h(Alert, { severity: 'error' }, "Admin-panel only for localhost"),
            h(Box, { mt: 2, fontSize: 'small' }, "because no admin account was configured")
        )
    if (loginRequired)
        return h(LoginForm)
    return h(Fragment, {}, children)
}

function LoginForm() {
    const [values, setValues] = useState({ username: '', password: '', ipChange: false })
    const [error, setError] = useState('')
    const formRef = useRef<HTMLFormElement>()
    const empty = formRef.current?.querySelector('input[value=""]')
    useEffect(() => (empty as any)?.focus?.(), [empty])
    return h(Center, {},
        h(Form, {
            formRef,
            values,
            m: 2,
            maxWidth: '25em',
            set(v, k) {
                setValues(values => ({ ...values, [k]: v }))
            },
            fields: [
                { k: 'username', autoComplete: 'username', autoFocus: true, required: true },
                { k: 'password', type: 'password', autoComplete: 'current-password', required: true },
                { k: 'ipChange', comp: BoolField, label: "Allow IP change during this session" },
            ],
            addToBar: [ error && h(Alert, { severity: 'error', sx: { flex: 1 } }, error) ],
            saveOnEnter: true,
            save: {
                children: "Enter",
                startIcon: null,
                async onClick() {
                    try {
                        setError('')
                        await login(values.username, values.password, {
                            [CFG.allow_session_ip_change]: values.ipChange
                        })
                    }
                    catch(e) {
                        setError(String(e))
                    }
                }
            }
        })
    )
}

async function login(username: string, password: string, extra?: object) {
    const res = await srpClientSequence(username, password, apiCall, extra).catch(err => {
        throw err?.code === HTTP_UNAUTHORIZED ? "Wrong username or password"
            : err === 'trust' ? "Login aborted: server identity cannot be trusted"
            : err?.name === 'AbortError' ? "Server didn't respond"
            : (err?.message || "Unknown error")
    })
    if (!res.adminUrl)
        throw "This account has no Admin access"

    // login was successful, update state
    state.loginRequired = false
    refreshSession(res)
}

const refreshSession = makeSessionRefresher(state)

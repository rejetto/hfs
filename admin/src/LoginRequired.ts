import { state, useSnapState } from './state'
import { createElement as h, Fragment, useState } from 'react'
import { Center } from './misc'
import { Form } from './Form'
import { apiCall } from './api'
import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'
import { LoadingButton } from '@mui/lab'
import { Alert } from '@mui/material'

export function LoginRequired({ children }: any) {
    const { loginRequired } = useSnapState()
    if (loginRequired)
        return h(LoginForm)
    return h(Fragment, {}, children)
}

function LoginForm() {
    const [values, setValues] = useState({ username: '', password: '' })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    return h(Center, { flexDirection: 'column', gap: 2 },
        h(Form, {
            values: {},
            set(v, { k }) {
                setValues({ ...values, [k]: v })
            },
            fields: [
                { k: 'username', autoComplete: 'username' },
                { k: 'password', type: 'password', autoComplete: 'current-password' },
            ]
        }),
        h(LoadingButton, {
            variant: 'contained',
            loading,
            async onClick() {
                const { username, password } = values
                if (!username || !password) return
                setLoading(true)
                try {
                    await login(username, password)
                    setError('')
                    state.loginRequired = false
                    state.username = username
                }
                catch(e) {
                    setError(String(e))
                }
                finally {
                    setLoading(false)
                }
            }
        }, "Enter"),
        h(Alert, { sx: { visibility: error ? '' : 'hidden' }, severity: 'error' }, error)
    )
}

async function login(username: string, password: string) {
    const WRONG = "Wrong username or password"
    const { pubKey, salt } = await apiCall('loginSrp1', { username })
        .catch(() => { throw WRONG })
    if (!salt)
        throw "Bad response from server"

    const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
    const srp = new SRPClientSession(srp6aNimbusRoutines);
    const resStep1 = await srp.step1(username, password)
    const resStep2 = await resStep1.step2(BigInt(salt), BigInt(pubKey))
    const res = await apiCall('loginSrp2', { pubKey: String(resStep2.A), proof: String(resStep2.M1) }) // bigint-s must be cast to string to be json-ed
        .catch(() => { throw WRONG })
    await resStep2.step3(BigInt(res.proof))
        .catch(() => { throw "Login aborted: server identity cannot be trusted" })
    if (!res.adminUrl)
        throw "This account has no Admin access"

    // login was successful, update state
    sessionRefresher({ username, exp:res.exp })
}

// @ts-ignore
sessionRefresher(window.SESSION)

function sessionRefresher(response: any) {
    if (!response) return
    const { exp, username } = response
    state.username = username
    if (!username || !exp) return
    const delta = new Date(exp).getTime() - Date.now()
    const t = Math.min(delta - 30_000, 600_000)
    console.debug('session refresh in', Math.round(t/1000))
    setTimeout(() => apiCall('refresh_session').then(sessionRefresher), t)
}

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall } from './api'
import { state } from './state'
import { alertDialog, newDialog } from './dialog'
import { hIcon, srpSequence, working } from './misc'
import { useNavigate } from 'react-router-dom'
import { createElement as h, useEffect, useRef } from 'react'

async function login(username:string, password:string) {
    const stopWorking = working()
    return srpSequence(username, password, apiCall).then(res => {
        stopWorking()
        sessionRefresher(res)
        state.loginRequired = false
        return res
    }, (err: any) => {
        stopWorking()
        throw Error(err.message === 'trust' ? "Login aborted: server identity cannot be trusted"
            : err.code === 401 ? "Invalid credentials"
                : err.code === 409 ? "Cookies not working - login failed"
                    : err.message)
    })
}

// @ts-ignore
sessionRefresher(window.SESSION)

function sessionRefresher(response: any) {
    if (!response) return
    const { exp, username, adminUrl } = response
    state.username = username
    state.adminUrl = adminUrl
    if (!username || !exp) return
    const delta = new Date(exp).getTime() - Date.now()
    const t = Math.min(delta - 30_000, 600_000)
    console.debug('session refresh in', Math.round(t/1000))
    setTimeout(() => apiCall('refresh_session').then(sessionRefresher), t)
}

export function logout(){
    return apiCall('logout').catch(res => {
        if (res.code === 401) // we expect 401
            state.username = ''
        else
            throw res
    })
}

export async function loginDialog(navigate: ReturnType<typeof useNavigate>) {
    return new Promise(resolve => {
        const closeDialog = newDialog({
            className: 'dialog-login',
            icon: () => hIcon('login'),
            onClose: resolve,
            title: "Login",
            Content() {
                const usrRef = useRef<HTMLInputElement>()
                const pwdRef = useRef<HTMLInputElement>()
                useEffect(() => {
                    setTimeout(() => usrRef.current?.focus()) // setTimeout workarounds problem due to double-mount while in dev
                }, [])
                return h('form', {
                    onSubmit(ev:any) {
                        ev.preventDefault()
                        go()
                    }
                },
                    h('div', { className: 'field' },
                        h('label', { htmlFor: 'username' }, "Username"),
                        h('input', {
                            ref: usrRef,
                            name: 'username',
                            autoComplete: 'username',
                            required: true,
                            onKeyDown
                        }),
                    ),
                    h('div', { className: 'field' },
                        h('label', { htmlFor: 'password' }, "Password"),
                        h('input', {
                            ref: pwdRef,
                            name: 'password',
                            type: 'password',
                            autoComplete: 'current-password',
                            required: true,
                            onKeyDown
                        }),
                    ),
                    h('div', { style: { textAlign: 'right' } },
                        h('button', { type: 'submit' }, "Continue")),
                )

                function onKeyDown(ev: KeyboardEvent) {
                    const { key } = ev
                    if (key === 'Escape')
                        return closeDialog(null)
                    if (key === 'Enter')
                        return go()
                }

                async function go(ev?: Event) {
                    ev?.stopPropagation()
                    const usr = usrRef.current?.value
                    const pwd = pwdRef.current?.value
                    if (!usr || !pwd) return
                    try {
                        const res = await login(usr, pwd)
                        closeDialog()
                        if (res?.redirect)
                            navigate(res.redirect)
                    } catch (err: any) {
                        await alertDialog(err)
                        usrRef.current?.focus()
                    }
                }

            }
        })
    })
}

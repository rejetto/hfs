// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall } from '@hfs/shared/api'
import { state, useSnapState } from './state'
import { alertDialog, newDialog } from './dialog'
import { getHFS, getPrefixUrl, hIcon, srpSequence, working } from './misc'
import { useNavigate } from 'react-router-dom'
import { createElement as h, Fragment, useEffect, useRef } from 'react'
import { t, useI18N } from './i18n'
import { reloadList } from './useFetchList'
import { CustomCode } from './components'
import _ from 'lodash'

async function login(username:string, password:string) {
    const stopWorking = working()
    return srpSequence(username, password, apiCall).then(res => {
        stopWorking()
        sessionRefresher(res)
        state.loginRequired = false
        reloadList()
        return res
    }, (err: any) => {
        stopWorking()
        throw Error(err.message === 'trust' ? t('login_untrusted', "Login aborted: server identity cannot be trusted")
            : err.code === 401 ? t('login_bad_credentials', "Invalid credentials")
                : err.code === 409 ? t('login_bad_cookies', "Cookies not working - login failed")
                    : t(err.message))
    })
}

sessionRefresher(getHFS().session)

function sessionRefresher(response: any) {
    if (!response) return
    const { exp, username, adminUrl } = response
    state.username = username
    state.adminUrl = adminUrl
    if (!username || !exp) return
    const delta = new Date(exp).getTime() - Date.now()
    const t = _.clamp(delta - 30_000, 5_000, 600_000)
    console.debug('session refresh in', Math.round(t/1000))
    setTimeout(() => apiCall('refresh_session').then(sessionRefresher), t)
}

export function logout(){
    return apiCall('logout').catch(res => {
        if (res.code !== 401) // we expect 401
            throw res
        state.username = ''
        reloadList()
    })
}

export let closeLoginDialog: undefined | (() => void)
let lastPromise: Promise<any>
export async function loginDialog(navigate: ReturnType<typeof useNavigate>) {
    return lastPromise = new Promise(resolve => {
        if (closeLoginDialog)
            return lastPromise
        const closeDialog = closeLoginDialog = newDialog({
            className: 'login-dialog dialog-login',
            icon: () => hIcon('login'),
            onClose(v) {
                resolve(v)
                closeLoginDialog = undefined
            },
            title: () => h(Fragment, {}, useI18N().t(`Login`)), // this dialog could be displayed before the language has been loaded
            Content() {
                const usrRef = useRef<HTMLInputElement>()
                const pwdRef = useRef<HTMLInputElement>()
                useEffect(() => {
                    setTimeout(() => usrRef.current?.focus()) // setTimeout workarounds problem due to double-mount while in dev
                }, [])
                const {t} = useI18N() // this dialog can be displayed before anything else, accessing protected folder, and needs to be rendered after languages loading
                return h('form', {
                    onSubmit(ev:any) {
                        ev.preventDefault()
                        go()
                    }
                },
                    h(CustomCode, { name: 'beforeLogin' }),
                    h('div', { className: 'field' },
                        h('label', { htmlFor: 'username' }, t`Username`),
                        h('input', {
                            ref: usrRef,
                            name: 'username',
                            autoComplete: 'username',
                            required: true,
                            onKeyDown
                        }),
                    ),
                    h('div', { className: 'field' },
                        h('label', { htmlFor: 'password' }, t`Password`),
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
                        h('button', { type: 'submit' }, t`Continue`)),
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
                            navigate(getPrefixUrl() + res.redirect)
                    } catch (err: any) {
                        await alertDialog(err)
                        usrRef.current?.focus()
                    }
                }

            }
        })
    })
}

export function useAuthorized() {
    const { loginRequired } = useSnapState()
    if (location.hash === '#LOGIN')
        state.loginRequired = true
    const navigate = useNavigate()
    useEffect(() => {
        (async () => {
            if (!loginRequired)
                return closeLoginDialog?.()
            if (closeLoginDialog) return
            while (state.loginRequired)
                await loginDialog(navigate)
        })()
    }, [loginRequired, navigate])
    return loginRequired ? null : true
}

function tElement(s: string) {
    const {t} = useI18N()
    return t(s)
}

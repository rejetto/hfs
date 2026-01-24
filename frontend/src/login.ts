// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall } from '@hfs/shared/api'
import { state, useSnapState } from './state'
import { alertDialog, newDialog, toast } from './dialog'
import {
    getHFS, hIcon, makeSessionRefresher, srpClientSequence, working, fallbackToBasicAuth, hfsEvent,
    HTTP_CONFLICT, HTTP_UNAUTHORIZED, HTTP_METHOD_NOT_ALLOWED, ALLOW_SESSION_IP_CHANGE,
} from './misc'
import { createElement as h, Fragment, useEffect, useRef } from 'react'
import { reloadList } from './useFetchList'
import { Checkbox, CustomCode } from './components'
import { changePassword } from './UserPanel'
import _ from 'lodash'
import i18n from './i18n'
const { t, useI18N } = i18n

async function login(username:string, password:string, extra?: object) {
    const stopWorking = working()
    return srpClientSequence(username, password, apiCall, extra).catch(err => {
        if (err.code == HTTP_METHOD_NOT_ALLOWED || !password) // allow alternative authentications without a password
            return apiCall('login', { username, password, ...extra })
        throw err
    }).then(res => {
        hfsEvent('loginOk', { username })
        refreshSession(res)
        state.loginRequired = false
        return res
    }, err => {
        hfsEvent('loginFailed', { username, error: err }) // the name inconsistency with the backend event 'failedLogin' can make it easier to distinguish
        throw Error(err.data === 'trust' ? t('login_untrusted', "Login aborted: server identity cannot be trusted")
            : err.code === HTTP_UNAUTHORIZED && !err.data ? t('login_bad_credentials', "Invalid credentials") // err.data is empty on standard errors, but a plugin may want to show differently
                : err.code === HTTP_CONFLICT ? t('login_bad_cookies', "Cookies not working - login failed")
                    : t(err.message || String(err)) )
    }).finally(stopWorking)
}

const refreshSession = makeSessionRefresher(state)

export function logout() {
    return apiCall('logout', {}, { modal: working }).catch(res => {
        if (res.code !== HTTP_UNAUTHORIZED) // we expect this error code
            throw res
        state.username = ''
        if (fallbackToBasicAuth())
            return location.reload() // reloading avoids nasty warnings with ff52
        reloadList()
        toast(t`Logged out`, 'success')
    })
}

export let closeLoginDialog: undefined | (() => void)
let lastPromise: Promise<any>
export async function loginDialog(closable=true, reloadAfter=true) {
    return lastPromise = new Promise(resolve => {
        if (fallbackToBasicAuth())
            return location.href = '/?get=login'
        if (closeLoginDialog)
            return lastPromise // this refers to the previous promise, as lastPromise wille be updated only after this function ends
        let going = false
        const { close } = newDialog({
            closable,
            className: 'login-dialog',
            icon: () => hIcon('login'),
            onClose(v) {
                resolve(v)
                closeLoginDialog = undefined
            },
            title: () => h(Fragment, {}, useI18N().t(`Login`)), // this dialog could be displayed before the language has been loaded
            Content() {
                const usrRef = useRef<HTMLInputElement>()
                const pwdRef = useRef<HTMLInputElement>()
                const ipRef = useRef<HTMLInputElement>()
                useEffect(() => {
                    setTimeout(() => usrRef.current?.focus()) // setTimeout workarounds problem due to double-mount while in dev
                }, [])
                const {t} = useI18N() // this dialog can be displayed before anything else, accessing protected folder, and needs to be rendered after languages loading
                return h('form', {
                    onSubmit(ev:any) {
                        ev.preventDefault()
                        go(ev)
                    }
                },
                    h(CustomCode, { name: 'beforeLogin' }),
                    h(CustomCode, { name: 'loginUsernameField' }, h('div', { className: 'field' },
                        h('label', { htmlFor: 'login_username' }, t`Username`),
                        h('input', {
                            ref: usrRef,
                            id: 'login_username',
                            name: 'username',
                            autoComplete: 'username',
                            required: true,
                            onKeyDown
                        }),
                    )),
                    h(CustomCode, { name: 'loginPasswordField' }, h('div', { className: 'field' },
                        h('label', { htmlFor: 'login_password' }, t`Password`),
                        h('input', {
                            ref: pwdRef,
                            id: 'login_password',
                            name: 'password',
                            type: 'password',
                            autoComplete: 'current-password',
                            required: true,
                            onKeyDown
                        }),
                    )),
                    h(CustomCode, { name: 'beforeLoginSubmit' }),
                    h('div', { className: 'submit' },
                        h('button', { type: 'submit' }, t`Continue`)),
                    h('div', { id: 'login-options' },
                        h(Checkbox, { ref: ipRef, id: ALLOW_SESSION_IP_CHANGE },
                            t(ALLOW_SESSION_IP_CHANGE, "Allow IP change during this session")),
                    ),
                )

                function onKeyDown(ev: KeyboardEvent) {
                    const { key } = ev
                    if (key === 'Escape')
                        return close(null)
                    if (key === 'Enter')
                        return go(ev)
                }

                async function go(ev: Event) {
                    const form = ev.target instanceof HTMLElement && ev.target.closest('form')
                    if (!form) return
                    ev.stopPropagation()
                    const { username, password, ...rest } = _.pickBy(Object.fromEntries(new FormData(form).entries()), _.isString) // skip files
                    const u = username.trim()
                    if (going || !u) return
                    going = true
                    try {
                        const res = await login(u, password, {
                            [ALLOW_SESSION_IP_CHANGE]: ipRef.current?.checked,
                            ...rest
                        }).finally(() => going = false)
                        await close(true)
                        toast(t`Logged in`, 'success')
                        if (res?.redirect)
                            setTimeout(() => // workaround: the history.back() issued by closing the dialog is messing with our navigation
                                getHFS().navigate(res.redirect), 10) // from my tests 1 was enough, 0 was not (not always). Would be nice to find a cleaner way
                        else if (reloadAfter)
                            reloadList()
                    } catch (err: any) {
                        await alertDialog(err)
                        usrRef.current?.focus()
                    }
                }

            }
        })
        closeLoginDialog = close
    })
}

export function useAuthorized() {
    const { loginRequired, username } = useSnapState()
    const last = useRef('')
    useEffect(() => {
        if (last.current === username) return // need to remember because we are not undoing our useEffect
        last.current = username
        if (username && getHFS().session?.requireChangePassword)
            changePassword(true)
    }, [username])
    useEffect(() => {
        if (!loginRequired)
            closeLoginDialog?.()
        else if (!closeLoginDialog)
            void loginDialog(false)
    }, [loginRequired])
    return loginRequired ? null : true
}

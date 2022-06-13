// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { apiCall, ApiError } from './api'
import { state } from './state'
import { alertDialog } from './dialog'
import { srpSequence, working } from './misc'

export async function login(username:string, password:string) {
    const stopWorking = working()
    return srpSequence(username, password, apiCall).then(res => {
        stopWorking()
        sessionRefresher(res)
        state.loginRequired = false
        return res
    }, (err: Error) => {
        stopWorking()
        if (err.message === 'trust')
            err = Error("Login aborted: server identity cannot be trusted")
        else if (err instanceof ApiError)
            if (err.code === 401)
                err = Error("Invalid credentials")
            else if (err.code === 409)
                err = Error("Cookies not working - login failed")
        return alertDialog(err)
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
    return apiCall('logout').then(()=> {
        state.username = ''
    })
}

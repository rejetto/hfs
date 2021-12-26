import { apiCall, ApiError } from './api'
import { state } from './state'
import { alertDialog } from './dialog'

let refresher: NodeJS.Timeout

export async function login(user:string, password:string) {
    if (refresher)
        clearInterval(refresher)
    try {
        const res = await apiCall('login', { user, password })
        sessionRefresher(res)
        state.username = user
    }
    catch(err) {
        if (err instanceof ApiError)
            if (err.code === 401)
                err = 'Invalid credentials'
        await alertDialog(err as Error, 'error')
    }
}
apiCall('refresh_session').then(sessionRefresher, ()=>{})

function sessionRefresher({ exp, user }:{ exp:string, user:string }) {
    state.username = user
    if (!exp) return
    const delta = new Date(exp).getTime() - Date.now()
    const every = delta - 30_000
    console.debug('session refresh every', Math.round(every/1000))
    refresher = setInterval(() => apiCall('refresh_session'),  every)
}

export function logout(){
    return apiCall('logout').then(()=> state.username = '')
}

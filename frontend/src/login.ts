import { apiCall, ApiError } from './api'
import { state } from './state'
import { alertDialog } from './dialog'
import { SRPClientSession, SRPParameters, SRPRoutines } from 'tssrp6a'
import { working } from './misc'

let refresher: NodeJS.Timeout

export async function login(username:string, password:string) {
    if (refresher)
        clearInterval(refresher)
    const stopWorking = working()
    try {
/* simple login without encryption. Here commented just for example. Please use SRP version.
        const res = await apiCall('login', { username, password })
*/
        const { pubKey, salt } = await apiCall('loginSrp1', { username })
        if (!salt) return

        const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
        const srp = new SRPClientSession(srp6aNimbusRoutines);
        const resStep1 = await srp.step1(username, password)
        const resStep2 = await resStep1.step2(BigInt(salt), BigInt(pubKey))
        const res = await apiCall('loginSrp2', { pubKey: String(resStep2.A), proof: String(resStep2.M1) }) // bigint-s must be cast to string to be json-ed
        try {
            await resStep2.step3(BigInt(res.proof))
        }
        catch(e){
            console.debug(String(e))
            stopWorking()
            await alertDialog("Server identity cannot be trusted. Login aborted.", 'error')
            return
        }

        // login was successful, update state
        sessionRefresher({ username, exp:res.exp })
        state.username = username
        return res
    }
    catch(err) {
        stopWorking()
        if (err instanceof ApiError)
            if (err.code === 401)
                err = 'Invalid credentials'
        await alertDialog(err as Error, 'error')
    }
    finally { stopWorking() }
}

// @ts-ignore
if (window.SESSION) sessionRefresher(window.SESSION)

function sessionRefresher({ exp, username }:{ exp:string, username:string }) {
    state.username = username
    if (!exp) return
    const delta = new Date(exp).getTime() - Date.now()
    const every = delta - 30_000
    console.debug('session refresh every', Math.round(every/1000))
    refresher = setInterval(() => apiCall('refresh_session'),  every)
}

export function logout(){
    return apiCall('logout').then(()=> {
        clearInterval(refresher)
        state.username = ''
    })
}

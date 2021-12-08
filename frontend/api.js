import { useEffect, useState } from "./main.js";

export function apiCall(cmd, params) {
    return fetch('/~/api/'+cmd, {
        method: 'POST',
        body:params && JSON.stringify(params)
    }).then(res => {
        if (res.ok)
            return res.json()
        const msg = 'Failed API ' + cmd + (params ? ' ' + JSON.stringify(params) : '')
        console.warn(msg)
        throw Error(msg)
    })
}

export function useApi(cmd, params) {
    const [x, setX] = useState()
    useEffect(()=>{
        apiCall(cmd, params).then(setX, setX)
    }, [cmd])
    return x
}
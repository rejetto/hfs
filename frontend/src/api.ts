import { useEffect, useState } from 'react';

export function apiCall(cmd: string, params?: object) : Promise<any> {
    return fetch('/~api/'+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: params && JSON.stringify(params),
    }).then(res => {
        if (res.ok)
            return res.json()
        const msg = 'Failed API ' + cmd + (params ? ' ' + JSON.stringify(params) : '')
        console.warn(msg)
        throw Error(msg)
    })
}

export function useApi(cmd: string, params?: object) : any {
    const [x, setX] = useState()
    useEffect(()=>{
        apiCall(cmd, params).then(setX, setX)
    }, [cmd, JSON.stringify(params)]) //eslint-disable-line
    return x
}
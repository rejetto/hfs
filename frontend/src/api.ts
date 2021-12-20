import { useEffect, useState } from 'react';
import { Falsy } from './misc'

export function apiCall(cmd: string, params?: object) : Promise<any> {
    return fetch('/~/api/'+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: params && JSON.stringify(params),
    }).then(res => {
        if (res.ok)
            return res.json()
        const msg = 'Failed API ' + cmd
        console.warn(msg + (params ? ' ' + JSON.stringify(params) : ''))
        throw new ApiError(res.status, msg)
    })
}

export class ApiError extends Error {
    constructor(readonly code:number, message: string) {
        super(message);
    }
}

export function useApi(cmd: string | Falsy, params?: object) : any {
    const [x, setX] = useState()
    useEffect(()=>{
        setX(undefined)
        if (cmd)
            apiCall(cmd, params).then(setX, setX)
    }, [cmd, JSON.stringify(params)]) //eslint-disable-line
    return x
}

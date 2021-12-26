import { useEffect, useState } from 'react';
import { Falsy, working } from './misc'

const PREFIX = '/~/api/'

export function apiCall(cmd: string, params?: object) : Promise<any> {
    const stop = working()
    return fetch(PREFIX+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: params && JSON.stringify(params),
    }).then(res => {
        if (res.ok)
            return res.json()
        const msg = 'Failed API ' + cmd
        console.warn(msg + (params ? ' ' + JSON.stringify(params) : ''))
        throw new ApiError(res.status, msg)
    }).finally(stop)
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

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: object, cb:EventHandler) {
    const source = new EventSource(PREFIX + cmd + '?' + new URLSearchParams(params as any))
    source.onopen = () => cb('connected')
    source.onerror = err => cb('error', err)
    source.onmessage = ({ data }) => {
        if (!data) {
            cb('closed')
            return source.close()
        }
        try { data = JSON.parse(data) }
        catch(e) {
            return cb('string', data)
        }
        cb('msg', data)
    }
    return source
}


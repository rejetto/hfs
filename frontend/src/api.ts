// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useEffect, useState } from 'react';
import { Dict, Falsy, getCookie, working } from './misc'

const PREFIX = '/~/api/'

interface ApiCallOptions { noModal?:true }
export function apiCall(cmd: string, params?: Dict, options: ApiCallOptions={}) : Promise<any> {
    const stop = options.noModal ? undefined : working()
    const csrf = getCsrf()
    if (csrf)
        params = { csrf, ...params }
    return fetch(PREFIX+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: params && JSON.stringify(params),
    }).then(res => {
        stop?.()
        if (res.ok)
            return res.json()
        const msg = `Failed API ${cmd}: ${res.statusText}`
        console.warn(msg + (params ? ' ' + JSON.stringify(params) : ''))
        throw new ApiError(res.status, msg)
    }, err => {
        stop?.()
        if (err?.message?.includes('fetch'))
            throw Error("Network error")
        throw err
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

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    const csrf = getCsrf()
    const processed: Record<string,string> = { csrf: csrf && JSON.stringify(csrf) }
    for (const k in params) {
        const v = params[k]
        if (v === undefined) continue
        processed[k] = JSON.stringify(v)
    }
    const source = new EventSource(PREFIX + cmd + '?' + new URLSearchParams(processed))
    source.onopen = () => cb('connected')
    source.onerror = err => cb('error', err)
    source.onmessage = ({ data }) => {
        if (!data) {
            cb('closed')
            return source.close()
        }
        try { data = JSON.parse(data) }
        catch {
            return cb('string', data)
        }
        cb('msg', data)
    }
    return source
}

function getCsrf() {
    return getCookie('csrf')
}

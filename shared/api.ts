// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash';
import { useCallback, useEffect, useRef } from 'react';
import { Dict, Falsy, getCookie, getPrefixUrl, pendingPromise, useStateMounted } from '.'

const PREFIX = getPrefixUrl() + '/~/api/'

const timeoutByApi: Dict = {
    loginSrp1: 90, // support antibrute
    get_status: 20 // can be lengthy on slow machines because of the find-process-on-busy-port feature
}

interface ApiCallOptions {
    timeout?: number | false
    modal?: undefined | ((cmd: string, params?: Dict) => (() => unknown))
    onResponse?: (res: Response, body: any) => any
}

const defaultApiCallOptions: ApiCallOptions = {}
export function setDefaultApiCallOptions(options: Partial<ApiCallOptions>) {
    Object.assign(defaultApiCallOptions, options)
}

export function apiCall<T=any>(cmd: string, params?: Dict, options: ApiCallOptions={}) {
    _.defaults(options, defaultApiCallOptions)
    const stop = options.modal?.(cmd, params)
    const csrf = getCsrf()
    if (csrf)
        params = { csrf, ...params }
    const controller = new AbortController()
    if (options.timeout !== false)
        setTimeout(() => controller.abort('timeout'), 1000*(timeoutByApi[cmd] ?? options.timeout ?? 10))
    return Object.assign(fetch(PREFIX + cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: params && JSON.stringify(params),
    }).then(async res => {
        stop?.()
        let body: any = await res.text()
        try { body = JSON.parse(body) }
        catch {}
        console.debug(res.ok ? 'API' : 'API FAILED', cmd, params, '>>', body)
        await options.onResponse?.(res, body)
        if (!res.ok)
            throw new ApiError(res.status, body || `Failed API ${cmd}: ${res.statusText}`)
        return body as T
    }, err => {
        stop?.()
        if (err?.message?.includes('fetch'))
            throw Error("Network error")
        throw err
    }), {
        abort() {
            controller.abort('cancel')
        }
    })
}

export class ApiError extends Error {
    constructor(readonly code:number, message: string) {
        super(message);
    }
}

export function useApi<T=any>(cmd: string | Falsy, params?: object) : [T | undefined, undefined | Error, ()=>void] {
    const [ret, setRet] = useStateMounted<T | undefined>(undefined)
    const [err, setErr] = useStateMounted<Error | undefined>(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const loadingRef = useRef<ReturnType<typeof apiCall>>()
    const reloadingRef = useRef<any>()
    useEffect(()=>{
        loadingRef.current?.abort()
        setRet(undefined)
        setErr(undefined)
        if (!cmd) return
        let aborted = false
        const req = apiCall<T>(cmd, params)
        const wholePromise = req.then(x => aborted || setRet(x), x => aborted || setErr(x))
            .finally(()=> loadingRef.current = undefined)
        loadingRef.current = Object.assign(wholePromise, {
            abort() {
                aborted = true
                req.abort()
            }
        })
        reloadingRef.current?.resolve(wholePromise)
    }, [cmd, JSON.stringify(params), forcer]) //eslint-disable-line -- json-ize to detect deep changes
    const reload = useCallback(() => loadingRef.current
            || setForcer(v => v+1) || (reloadingRef.current = pendingPromise()),
        [setForcer])
    return [ret, err, reload]
}

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    console.debug('API EVENTS', cmd, params)
    const processed: Record<string,string> = {}
    for (const k in params) {
        const v = params[k]
        if (v !== undefined)
            processed[k] = JSON.stringify(v)
    }
    const csrf = getCsrf()
    if (csrf)
        processed.csrf = JSON.stringify(csrf)
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
        console.debug('SSE msg', data)
        cb('msg', data)
    }
    return source
}

function getCsrf() {
    return getCookie('csrf')
}

export function useApiEvents(cmd: string, params: Dict={}) {
    const [data, setData] = useStateMounted<any>(undefined)
    const [error, setError] = useStateMounted<any>(undefined)
    const [loading, setLoading] = useStateMounted(false)
    useEffect(() => {
        const src = apiEvents(cmd, params, (type, data) => {
            switch (type) {
                case 'error':
                    setError("Connection error")
                    return stop()
                case 'closed':
                    return stop()
                case 'msg':
                    if (src?.readyState === src?.CLOSED)
                        return stop()
                    return setData(data)
            }
        })
        return () => {
            src.close()
            stop()
        }

        function stop() {
            setLoading(false)
        }
    }, [cmd, JSON.stringify(params)]) //eslint-disable-line
    return { data, loading, error }
}

export async function getNotification(channel: string, cb: (name: string, data:any) => void): Promise<EventSource> {
    return new Promise(resolve => {
        const ret = apiEvents('get_notifications', { channel }, (type, entries) => {
            if (type === 'connected')
                return resolve(ret)
            if (type !== 'msg') return
            for (const { name, data } of entries)
                if (name)
                    cb(name, data)
        })
    })
}

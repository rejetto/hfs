// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash';
import { useCallback, useEffect, useRef } from 'react';
import { Dict, Falsy, getPrefixUrl, pendingPromise, useStateMounted, wait } from '.'

export const API_URL = '/~/api/'

const timeoutByApi: Dict = {
    loginSrp1: 90, // support antibrute
    update: 600, // download can be lengthy
    get_status: 20, // can be lengthy on slow machines because of the find-process-on-busy-port feature
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
    const controller = new AbortController()
    let aborted = ''
    const ms = 1000 * (timeoutByApi[cmd] ?? options.timeout ?? 10)
    const timeout = ms && setTimeout(() => {
        controller.abort(aborted = 'timeout')
        console.debug('API TIMEOUT', cmd, params??'')
    }, ms)
    return Object.assign(fetch(getPrefixUrl() + API_URL + cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        signal: controller.signal,
        body: params && JSON.stringify(params),
    }).then(async res => {
        stop?.()
        let body: any = await res.text()
        let data: any
        try { data = JSON.parse(body) }
        catch {}
        const result = data ?? body
        console.debug(res.ok ? 'API' : 'API FAILED', cmd, params??'', '>>', result)
        await options.onResponse?.(res, result)
        if (!res.ok)
            throw new ApiError(res.status, data === undefined ? body : `Failed API ${cmd}: ${res.statusText}`, data)
        return result as T
    }, err => {
        stop?.()
        if (err?.message?.includes('fetch'))
            throw Error("Network error")
        throw aborted || err
    }).finally(() => clearTimeout(timeout)), {
        abort() {
            controller.abort(aborted='cancel')
        }
    })
}

export class ApiError extends Error {
    constructor(readonly code:number, message: string, data?: any) {
        super(message, { cause: data });
    }
    get data() {
        return this.cause
    }
}

export function useApi<T=any>(cmd: string | Falsy, params?: object, options: ApiCallOptions={}) {
    const [data, setData] = useStateMounted<T | undefined>(undefined)
    const [error, setError] = useStateMounted<Error | undefined>(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const loadingRef = useRef<ReturnType<typeof apiCall>>()
    const reloadingRef = useRef<any>()
    useEffect(() => {
        loadingRef.current?.abort()
        setData(undefined)
        setError(undefined)
        if (!cmd) return
        let aborted = false
        let req: undefined | ReturnType<typeof apiCall>
        const wholePromise = wait(0) // postpone a bit, so that if it is aborted immediately, it is never really fired (happens mostly in dev mode)
            .then(() => aborted ? undefined : req = apiCall<T>(cmd, params, options))
            .then(res => aborted || setData(res), err => aborted || setError(err) || setData(undefined))
            .finally(() => loadingRef.current = reloadingRef.current = undefined)
        loadingRef.current = Object.assign(wholePromise, {
            abort() {
                aborted = true
                req?.abort()
            }
        })
        reloadingRef.current?.resolve(wholePromise)
    }, [cmd, JSON.stringify(params), forcer]) //eslint-disable-line -- json-ize to detect deep changes
    const reload = useCallback(() => loadingRef.current
            || setForcer(v => v+1) || (reloadingRef.current = pendingPromise()),
        [setForcer])
    return { data, setData, error, reload, loading: Boolean(loadingRef.current || reloadingRef.current) }
}

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    params = _.omitBy(params, _.isUndefined)
    console.debug('API EVENTS', cmd, params)
    const source = new EventSource(getPrefixUrl() + API_URL + cmd + '?' + new URLSearchParams(params))
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
            for (const [name, data] of entries)
                if (name)
                    cb(name, data)
        })
    })
}

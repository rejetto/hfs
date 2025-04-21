// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Callback, Dict, Falsy, getPrefixUrl, pendingPromise, useStateMounted, wait, buildUrlQueryString, Jsonify,
} from '.'
import { BetterEventEmitter } from '../src/events'

export const API_URL = '/~/api/'

const timeoutByApi: Dict = {
    loginSrp1: 90, // support antibrute
    login: 90,
    get_status: 20, // can be lengthy on slow machines because of the find-process-on-busy-port feature
}

interface ApiCallOptions {
    timeout?: number | false // seconds
    modal?: undefined | ((cmd: string, params?: Dict) => (() => unknown))
    onResponse?: (res: Response, body: any) => any
    method?: string
    skipParse?: boolean
    skipLog?: boolean
    restUri?: string
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
    const asRest = options.restUri
    // rebuilding the whole url makes it resistant to url-with-credentials
    return Object.assign(fetch(`${location.origin}${getPrefixUrl()}${asRest || (API_URL + cmd)}`, {
        method: asRest ? cmd : (options.method || 'POST'),
        headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        signal: controller.signal,
        body: params && JSON.stringify(params),
    }).then(async res => {
        stop?.()
        let body: any = await res.text()
        let data: any
        try { data = options.skipParse ? body : JSON.parse(body) }
        catch { data = body }
        if (!options?.skipLog)
            console.debug(res.ok ? 'API' : 'API FAILED', cmd, params??'', '>>', data)
        await options.onResponse?.(res, data)
        if (!res.ok)
            throw new ApiError(res.status, data === body ? body : `Failed API ${cmd}: ${res.statusText}`, data)
        return data as Awaited<T extends (...args: any[]) => infer R ? Awaited<R> : T>
    }, err => {
        stop?.()
        if (err?.message?.includes('fetch')) {
            console.error(err.message)
            throw Error("Server unreachable")
        }
        throw aborted || err
    }).finally(() => clearTimeout(timeout)), {
        abort() {
            controller.abort(aborted='cancel')
        },
        aborted: () => controller.signal.aborted
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

export type UseApi<T=unknown> = ReturnType<typeof useApi<T>>
export function useApi<T=any>(cmd: string | Falsy, params?: object, options: ApiCallOptions={}) {
    const [data, setData, getData] = useStateMounted<Jsonify<Awaited<ReturnType<typeof apiCall<T>>>> | undefined>(undefined)
    const [error, setError] = useStateMounted<Error | undefined>(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const [loading, setLoading, getLoading] = useStateMounted<undefined | ReturnType<typeof apiCall>>(undefined)
    const reloadPromise = useRef<any>()
    useEffect(() => {
        setError(undefined)
        const aborted = () => getLoading()?.aborted()
        const wholePromise = wait(0) // postpone a bit, so that if it is aborted immediately, it is never really fired (happens mostly in dev mode)
            .then(() => {
                const ret = !cmd || aborted() ? undefined : apiCall<T>(cmd, params, options)
                setLoading(ret)
                return ret
            })
            .then(res => aborted() || setData(res as any) || setError(undefined),
                err => {
                    if (aborted()) return
                    setError(err)
                    setData(undefined)
                })
            .finally(() => setLoading(reloadPromise.current = undefined))
        reloadPromise.current?.resolve(wholePromise)
        return () => { wholePromise.finally(() => getLoading()?.abort()) }
    }, [cmd, JSON.stringify(params), forcer]) //eslint-disable-line -- json-ize to detect deep changes
    const reload = useCallback(() => {
        if (getLoading()) return
        setForcer(v => v + 1)
        reloadPromise.current = pendingPromise()
    }, [setForcer])
    const ee = useMemo(() => new BetterEventEmitter, [])
    const sub = useCallback((cb: Callback) => ee.on('data', cb), [ee])
    useEffect(() => { ee.emit('data') }, [data])
    return { data, setData, getData, error, reload, sub, loading }
}

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    params = _.omitBy(params, _.isUndefined)
    const source = new EventSource(getPrefixUrl() + API_URL + cmd + buildUrlQueryString(params))
    source.onopen = () => {
        console.debug('API EVENTS', cmd, params)
        cb('connected')
    }
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

export function useApiEvents<T=any>(cmd: string, params: Dict={}) {
    const [data, setData] = useStateMounted<T | undefined>(undefined)
    const [error, setError] = useStateMounted<undefined | string>(undefined)
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

export async function getNotifications(channel: string, cb: (name: string, data:any) => void): Promise<EventSource> {
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

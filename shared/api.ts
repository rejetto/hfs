// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Callback, Dict, Falsy, getPrefixUrl, pendingPromise, useStateMounted, wait, buildUrlQueryString, Jsonify, formatTime
} from '.'
import { BetterEventEmitter } from '../src/events'
import { ApiHandler } from '../src/apiMiddleware'
import type { ApiError as BackendApiError } from '../src/apiMiddleware'
import type { Readable } from 'stream'

export const API_URL = '/~/api/'

const timeoutByApi: Dict = {
    loginSrp1: 90, // support antibrute
    login: 90,
    get_status: 20, // can be lengthy on slow machines because of the find-process-on-busy-port feature
    check_update: 20,
    get_vfs: 20, // multiple sources may be slow
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

// shortcut: if it's a function, consider its return type (without ApiError which is thrown instead, and others similarly)
type ApiData<FT> = Jsonify<FT extends (...args: any[]) => infer R ? SanitizeReturn<R> : SanitizeReturn<FT>>
type SanitizeReturn<R> = Exclude<Awaited<R>, BackendApiError | Readable | AsyncGenerator<any>>
export function apiCall<FT=any>(cmd: string, params?: Dict, options: ApiCallOptions={}) {
    _.defaults(options, defaultApiCallOptions)
    const stop = options.modal?.(cmd, params)
    const controller = window.AbortController ? new AbortController() : undefined
    let aborted = ''
    const ms = 1000 * (timeoutByApi[cmd] ?? options.timeout ?? 10)
    const timeout = ms && setTimeout(() => {
        controller?.abort(aborted = 'timeout')
        console.debug('API TIMEOUT', cmd, params??'')
    }, ms)
    const asRest = options.restUri
    const started = new Date
    // rebuilding the whole url makes it resistant to url-with-credentials
    return Object.assign(fetch(`${location.origin}${asRest || (getPrefixUrl() + API_URL + cmd)}`, {
        method: asRest ? cmd : (options.method || 'POST'),
        headers: { 'content-type': 'application/json', 'x-hfs-anti-csrf': '1' },
        signal: controller?.signal,
        body: params && JSON.stringify(params),
    }).then(async res => {
        stop?.()
        let body: any = await res.text()
        let data: ApiData<FT>
        try { data = options.skipParse ? body : JSON.parse(body) }
        catch { data = body }
        if (!options?.skipLog)
            console.debug(res.ok ? 'API' : 'API FAILED', cmd, params??'', '>>', data, { started: formatTime(started), duration: (Date.now() - +started) })
        await options.onResponse?.(res, data)
        if (!res.ok)
            throw new ApiError(res.status, data === body ? body : `Failed API ${cmd}: ${res.statusText}`, data)
        return data
    }, err => {
        stop?.()
        if (err?.message?.includes('fetch')) {
            console.error(err.message)
            throw Error("Server unreachable")
        }
        throw aborted || err
    }).finally(() => clearTimeout(timeout)), {
        abort() {
            controller?.abort(aborted='cancel')
        },
        aborted: () => controller?.signal.aborted
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


export type UseApi<FT extends ApiHandler=ApiHandler> = ReturnType<typeof useApi<FT>>
// FT is the type of the server-side function
export function useApi<FT extends ApiHandler>(cmd: string | Falsy, params?: object, options: ApiCallOptions={}) {
    type ApiReq = Promise<ApiData<FT>> & { abort(): void, aborted: () => boolean | undefined }
    const [data, setData, getData] = useStateMounted<ApiData<FT> | undefined>(undefined)
    const [error, setError] = useStateMounted<Error | undefined>(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const [loading, setLoading, getLoading] = useStateMounted<undefined | ApiReq>(undefined)
    const reloadPromise = useRef<any>()
    useEffect(() => {
        setError(undefined)
        let undone = false
        let currentReq: ApiReq | undefined
        const isAborted = () => undone || currentReq?.aborted()
        const wholePromise = wait(0) // postpone a bit so that if it is aborted immediately, it is never really fired (happens mostly in dev mode)
            .then(() => {
                if (undone) return
                currentReq = !cmd || isAborted() ? undefined : apiCall<FT>(cmd, params, options)
                setLoading(currentReq)
                return currentReq
            })
            .then(res => {
                setData(isAborted() ? undefined : res)
                setError(undefined)
            }, err => {
                setError(isAborted() ? undefined : err)
                setData(undefined)
            })
            .finally(() => {
                if (currentReq === getLoading()) // update loading only if it's only if it's still the current request
                    setLoading(undefined)
                reloadPromise.current = undefined
            })
        reloadPromise.current?.resolve(wholePromise)
        return () => {
            undone = true
            currentReq?.abort()
        }
    }, [cmd, JSON.stringify(params), JSON.stringify(options), forcer]) //eslint-disable-line -- json-ize to detect deep changes
    const reload = useCallback(() => {
        if (reloadPromise.current) return
        reloadPromise.current = pendingPromise()
        setForcer(v => v + 1)
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
                    if (src.readyState === src.CLOSED)
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

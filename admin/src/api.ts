// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useCallback, useEffect, useMemo, useRef } from 'react'
import { Dict, err2msg, Falsy, getCookie, IconBtn, spinner, useStateMounted, wantArray } from './misc'
import { Alert } from '@mui/material'
import _ from 'lodash'
import { state } from './state'
import { Refresh } from '@mui/icons-material'
import produce, { Draft } from 'immer'
import { try_ } from './misc'

export function useApiEx<T=any>(...args: Parameters<typeof useApi>) {
    const [data, error, reload] = useApi<T>(...args)
    const cmd = args[0]
    const loading = data === undefined
    const element = useMemo(() =>
            !cmd ? null
                : error ? h(Alert, { severity: 'error' }, String(error), h(IconBtn, { icon: Refresh, onClick: reload, sx: { m:'-8px 0 -8px 16px' } }))
                    : loading ? spinner()
                        : null,
        [error, cmd, loading, reload])
    return { data, error, reload, loading, element }
}

const PREFIX = '/~/api/'

const timeoutByApi: Dict = {
    get_status: 20 // can be lengthy on slow machines because of the find-process-on-busy-port feature
}
export function apiCall(cmd: string, params?: Dict, { timeout=undefined }={}) : Promise<any> {
    const csrf = getCsrf()
    if (csrf)
        params = { csrf, ...params }

    const controller = new AbortController()
    if (timeout !== false)
        setTimeout(() => controller.abort('timeout'), 1000*(timeoutByApi[cmd] ?? timeout ?? 10))
    return fetch(PREFIX+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: params && JSON.stringify(params),
    }).then(async res => {
        if (res.ok)
            return res.json().then(json => {
                console.debug('API', cmd, params, '>>', json)
                return json
            })
        const msg = await res.text() || 'Failed API ' + cmd
        console.warn(msg + (params ? ' ' + JSON.stringify(params) : ''))
        if (res.status === 401)
            state.loginRequired = Boolean(try_(() => JSON.parse(msg)?.any)) || 403
        throw new ApiError(res.status, msg)
    }, err => {
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

export function useApi<T=any>(cmd: string | Falsy, params?: object) : [T | undefined, undefined | Error, ()=>void] {
    const [ret, setRet] = useStateMounted<T | undefined>(undefined)
    const [err, setErr] = useStateMounted<Error | undefined>(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const loadingRef = useRef(false)
    useEffect(()=>{
        setRet(undefined)
        setErr(undefined)
        if (!cmd) return
        loadingRef.current = true
        apiCall(cmd, params)
            .then(setRet, setErr)
            .finally(()=> loadingRef.current = false)
    }, [cmd, JSON.stringify(params), forcer]) //eslint-disable-line -- json-ize to detect deep changes
    const reload = useCallback(()=> loadingRef.current || setForcer(v => v+1), [setForcer])
    return [ret, err, reload]
}

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    console.debug('API EVENTS', cmd, params)
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

export function useApiList<T=any>(cmd:string|Falsy, params: Dict={}, { addId=false, map=((x:any)=>x) }={}) {
    const [list, setList] = useStateMounted<T[]>([])
    const [props, setProps] = useStateMounted<any>(undefined)
    const [error, setError] = useStateMounted<any>(undefined)
    const [connecting, setConnecting] = useStateMounted(true)
    const [loading, setLoading] = useStateMounted(false)
    const [initializing, setInitializing] = useStateMounted(true)
    const idRef = useRef(0)
    useEffect(() => {
        if (!cmd) return
        const buffer: T[] = []
        const apply = _.debounce(() => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                setList(list => [ ...list, ...chunk ])
        }, 1000, { maxWait: 1000 })
        setError(undefined)
        setLoading(true)
        setConnecting(true)
        setInitializing(true)
        setList([])
        const src = apiEvents(cmd, params, (type, data) => {
            switch (type) {
                case 'connected':
                    setConnecting(false)
                    return setTimeout(() => apply.flush()) // this trick we'll cause first entries to be rendered almost immediately, while the rest will be subject to normal debouncing
                case 'error':
                    setError("Connection error")
                    return stop()
                case 'closed':
                    return stop()
                case 'msg':
                    wantArray(data).forEach(data => {
                        if (data === 'ready') {
                            apply.flush()
                            setInitializing(false)
                            return
                        }
                        if (data.error)
                            return setError(err2msg(data.error))
                        if (data.props)
                            return setProps(data.props)
                        if (data.add) {
                            const rec = map(data.add)
                            if (addId)
                                rec.id = ++idRef.current
                            buffer.push(rec)
                            apply()
                            return
                        }
                        if (data.remove) {
                            const matchOnList: ReturnType<typeof _.matches>[] = []
                            // first remove from the buffer
                            for (const key of data.remove) {
                                const match1 = _.matches(key)
                                if (_.isEmpty(_.remove(buffer, match1)))
                                    matchOnList.push(match1)
                            }
                            // then work the hooked state
                            if (_.isEmpty(matchOnList))
                                return
                            setList(list => {
                                const filtered = list.filter(rec => !matchOnList.some(match1 => match1(rec)))
                                return filtered.length < list.length ? filtered : list // avoid unnecessary changes
                            })
                            return
                        }
                        if (data.update) {
                            apply.flush() // avoid treating buffer
                            setList(list => {
                                const modified = [...list]
                                for (const { search, change } of data.update) {
                                    const idx = modified.findIndex(_.matches(search))
                                    if (idx >= 0)
                                        modified[idx] = { ...modified[idx], ...change }
                                }
                                return modified
                            })
                            return
                        }
                        console.debug('unknown api event', type, data)
                    })
                    if (src?.readyState === src?.CLOSED)
                        stop()
            }
        })

        return () => src.close()

        function stop() {
            setInitializing(false)
            setLoading(false)
            apply.flush()
        }
    }, [cmd, JSON.stringify(params)]) //eslint-disable-line
    return { list, props, loading, error, initializing, connecting, setList, updateList }

    function updateList(cb: (toModify: Draft<typeof list>) => void) {
        setList(produce(list, x => {
            cb(x)
        }))
    }
}

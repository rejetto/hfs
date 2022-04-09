// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, ReactElement, Fragment, useCallback, useEffect, useMemo, useRef } from 'react'
import { Dict, Falsy, getCookie, IconBtn, spinner, useStateMounted } from './misc'
import { Alert } from '@mui/material'
import _ from 'lodash'
import { state } from './state'
import { Refresh } from '@mui/icons-material'

export function useApiComp<T=any>(...args: Parameters<typeof useApi>): [T | ReactElement, ()=>void] {
    const [res, err, reload] = useApi<T>(...args)
    return useMemo(() =>
        !args[0] ? [h(Fragment), reload]
            : err ? [ h(Alert, { severity: 'error' }, String(err), h(IconBtn, { icon: Refresh, onClick: reload, sx: { m:'-8px 0 -8px 16px' } })), reload ]
                : res === undefined ? [spinner(), reload]
                    : [res, reload],
        [res, reload])
}

const PREFIX = '/~/api/'

export function apiCall(cmd: string, params?: Dict) : Promise<any> {
    params = addCsrf(params)

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10_000)
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
            state.loginRequired = true
        throw new ApiError(res.status, msg)
    }, err => {
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
    const processed: Record<string,string> = {}
    for (const k in params) {
        const v = params[k]
        if (v === undefined) continue
        processed[k] = v === true ? '1' : v
    }
    console.debug('API EVENTS', cmd, params)
    const source = new EventSource(PREFIX + cmd + '?' + new URLSearchParams(addCsrf(processed)))
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

function addCsrf(params?: Dict) {
    const csrf = getCookie('csrf')
    return csrf ? { csrf, ...params } : params
}

export function useApiList<T=any>(cmd:string|Falsy, params: Dict={}, { addId=false, map=((x:any)=>x) }={}) {
    const [list, setList] = useStateMounted<T[]>([])
    const [error, setError] = useStateMounted<any>(undefined)
    const [loading, setLoading] = useStateMounted(false)
    const idRef = useRef(0)
    useEffect(() => {
        if (!cmd) return
        const buffer: T[] = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                setList(list => [ ...list, ...chunk ])
        }
        setLoading(true)
        setList([])
        const timer = setInterval(flush, 1000)
        const src = apiEvents(cmd, params, (type, data) => {
            switch (type) {
                case 'error':
                    setError(JSON.stringify(data))
                    return stop()
                case 'closed':
                    flush()
                    return stop()
                case 'msg':
                    if (src?.readyState === src?.CLOSED)
                        return stop()
                    if (data.add) {
                        const rec = map(data.add)
                        if (addId)
                            rec.id = ++idRef.current
                        return buffer.push(rec)
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
                        flush() // avoid treating buffer
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
            }
        })

        return () => {
            src.close()
            stop()
        }

        function stop() {
            setLoading(false)
            clearInterval(timer)
        }
    }, [cmd, JSON.stringify(params)]) //eslint-disable-line
    return { list, loading, error }
}

import { createElement as h, useCallback, useEffect, useMemo } from 'react'
import { Dict, Falsy, getCookie, spinner, useStateMounted } from './misc'
import { Alert } from '@mui/material'
import _ from 'lodash'

export function useApiComp(...args: any[]): ReturnType<typeof useApi> {
    // @ts-ignore
    const [res, reload] = useApi(...args)
    return useMemo(() =>
        res === undefined ? [spinner(), reload]
            : res && res instanceof Error ? [h(Alert, { severity: 'error' }, String(res)), reload]
                : [res, reload],
        [res, reload])
}

const PREFIX = '/~/api/'

export function apiCall(cmd: string, params?: Dict) : Promise<any> {
    params = addCsrf(params)
    return fetch(PREFIX+cmd, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: params && JSON.stringify(params),
    }).then(res => {
        if (res.ok)
            return res.json().then(json => {
                console.debug('API', cmd, params, '>>', json)
                return json
            })
        const msg = 'Failed API ' + cmd
        console.warn(msg + (params ? ' ' + JSON.stringify(params) : ''))
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

export function useApi(cmd: string | Falsy, params?: object) : [any, ()=>void] {
    const [ret, setRet] = useStateMounted(undefined)
    const [forcer, setForcer] = useStateMounted(0)
    const [state] = useStateMounted({ loading: false })
    useEffect(()=>{
        setRet(undefined)
        if (!cmd) return
        state.loading = true
        apiCall(cmd, params)
            .then(setRet, setRet)
            .finally(()=> state.loading = false)
    }, [cmd, JSON.stringify(params), forcer]) //eslint-disable-line
    const reload = useCallback(()=> state.loading || setForcer(v => v+1), [])
    return [ret, reload]
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

export function useApiList<Record>(cmd:string|Falsy, params: Dict={}) {
    const [list, setList] = useStateMounted<Record[]>([])
    const [error, setError] = useStateMounted<any>(undefined)
    const [loading, setLoading] = useStateMounted(false)
    useEffect(() => {
        if (!cmd) return
        const buffer: Record[] = []
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
                    if (data.add)
                        return buffer.push(data.add)
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

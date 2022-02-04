import { createElement as h, useEffect, useMemo } from 'react'
import { Dict, Falsy, getCookie, spinner, useStateMounted } from './misc'
import { Alert } from '@mui/material'

export function useApiComp(...args: any[]): ReturnType<typeof useApi> {
    // @ts-ignore
    const [res, reload] = useApi(...args)
    return useMemo(() =>
        res === undefined ? [spinner(), reload]
            : res && res instanceof Error ? [h(Alert, { severity: 'error' }, String(res)), reload]
                : [res, reload],
        [res])
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
    return [ret, ()=> state.loading || setForcer(v => v+1)]
}

type EventHandler = (type:string, data?:any) => void

export function apiEvents(cmd: string, params: Dict, cb:EventHandler) {
    const processed: Record<string,string> = {}
    for (const k in params) {
        const v = params[k]
        if (v === undefined) continue
        processed[k] = v === true ? '1' : v
    }
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
    return { csrf: getCookie('csrf'), ...params }
}

export function useApiEvents<Record>(cmd:string|Falsy, params: Dict={}) {
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
                    buffer.push(data.entry)
            }
        })

        function stop() {
            setLoading(false)
            clearInterval(timer)
        }
    }, [cmd, JSON.stringify(params)])
    return { list, loading, error }
}

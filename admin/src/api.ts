// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { Dict, err2msg, Falsy, IconBtn, spinner, useStateMounted, wantArray } from './misc'
import { Alert } from '@mui/material'
import _ from 'lodash'
import { state } from './state'
import { Refresh } from '@mui/icons-material'
import produce, { Draft } from 'immer'
import { ApiError, apiEvents, setDefaultApiCallOptions, useApi } from '@hfs/shared/api'
export * from '@hfs/shared/api'

setDefaultApiCallOptions({
    async onResponse(res: Response, body: any) {
        if (res.status === 401) {
            state.loginRequired = body?.any !== false || 403
            throw new ApiError(res.status, "Unauthorized")
        }
    }
})

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

export function useApiList<T=any>(cmd:string|Falsy, params: Dict={}, { addId=false, map=((x:any)=>x) }={}) {
    const [list, setList] = useStateMounted<T[]>([])
    const [props, setProps] = useStateMounted<any>(undefined)
    const [error, setError] = useStateMounted<any>(undefined)
    const [connecting, setConnecting] = useStateMounted(true)
    const [loading, setLoading] = useStateMounted(false)
    const [initializing, setInitializing] = useStateMounted(true)
    const [reloader, setReloader] = useState(0)
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
                    wantArray(data).forEach(entry => {
                        if (entry === 'ready') {
                            apply.flush()
                            setInitializing(false)
                            return
                        }
                        if (entry.error) {
                            if (entry.error === 401)
                                state.loginRequired = entry.any !== false || 403
                            else
                                setError(err2msg(entry.error))
                            return
                        }
                        if (entry.props)
                            return setProps(entry.props)
                        if (entry.add) {
                            const rec = map(entry.add)
                            if (addId)
                                rec.id = ++idRef.current
                            buffer.push(rec)
                            apply()
                            return
                        }
                        if (entry.remove) {
                            const matchOnList: ReturnType<typeof _.matches>[] = []
                            // first remove from the buffer
                            for (const key of entry.remove) {
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
                        if (entry.update) {
                            apply.flush() // avoid treating buffer
                            setList(list => {
                                const modified = [...list]
                                for (const { search, change } of entry.update) {
                                    const idx = modified.findIndex(_.matches(search))
                                    if (idx >= 0)
                                        modified[idx] = { ...modified[idx], ...change }
                                }
                                return modified
                            })
                            return
                        }
                        console.debug('unknown api event', type, entry)
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
    }, [reloader, cmd, JSON.stringify(params)]) //eslint-disable-line
    return { list, props, loading, error, initializing, connecting, setList, updateList, reload }

    function reload() {
        setReloader(x => x + 1)
    }

    function updateList(cb: (toModify: Draft<typeof list>) => void) {
        setList(produce(list, x => {
            cb(x)
        }))
    }
}

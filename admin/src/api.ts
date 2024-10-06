// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { Dict, err2msg, Falsy, LIST, useStateMounted, wantArray, xlate, objSameKeys,
    HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from './misc'
import { IconBtn, spinner } from './mui'
import { Alert } from '@mui/material'
import _ from 'lodash'
import { state } from './state'
import { Refresh } from '@mui/icons-material'
import produce, { Draft } from 'immer'
import { ApiError, apiEvents, setDefaultApiCallOptions, useApi } from '@hfs/shared/api'
export * from '@hfs/shared/api'

setDefaultApiCallOptions({
    async onResponse(res: Response, body: any) {
        if (res.status === HTTP_UNAUTHORIZED) {
            state.loginRequired = body?.possible !== false || HTTP_FORBIDDEN
            throw new ApiError(res.status, "Unauthorized")
        }
    }
})

const ERRORS = { timeout: "Operation timeout" }
// expand useApi with things that cannot be shared with Frontend
export type ApiObject<T=any> = ReturnType<typeof useApiEx<T>>
export function useApiEx<T=any>(...args: Parameters<typeof useApi>) {
    const res = useApi<T>(...args)
    return {
        ...res,
        element: useMemo(() =>
            !args[0] ? null
                : res.error ? h(Alert, { severity: 'error' }, xlate(String(res.error), ERRORS),
                                    h(IconBtn, { icon: Refresh, title: "Reload", onClick: res.reload, sx: { m:'-10px 0 -8px 16px' } }) )
                    : res.data === undefined ? spinner()
                        : null,
            Object.values(res))
    }
}

export function useApiList<T=any, S=T>(cmd:string|Falsy, params: Dict={}, { map, invert, pause, limit }: { limit?: number, pause?: boolean, invert?: boolean, map?: (rec: S) => T }={}) {
    const [list, setList] = useStateMounted<T[]>([])
    const [props, setProps] = useStateMounted<any>(undefined)
    const [error, setError] = useStateMounted<any>(undefined)
    const [connecting, setConnecting] = useStateMounted(true)
    const [loading, setLoading] = useStateMounted(false)
    const [initializing, setInitializing] = useStateMounted(true)
    const [reloader, setReloader] = useState(0)
    const idGenerator = useRef(0)
    const [pausedList, setPausedList] = useState<typeof list | undefined>()
    useEffect(() => setPausedList(pause ? list : undefined), [pause])
    useEffect(() => {
        if (!cmd) return
        const bufferAdd: T[] = []
        const apply = _.debounce(() => {
            const chunk = bufferAdd.splice(0, Infinity)
            if (!chunk.length) return
            if (invert) chunk.reverse() // don't move this inside setList, as its callback can be called twice (and will, in dev)
            setList(list => {
                if (invert) {
                    const ret = [...chunk, ...list]
                    ret.splice(limit ?? Infinity, Infinity)
                    return ret
                }
                const ret = [...list, ...chunk]
                ret.splice(0, length - (limit ?? Infinity))
                return ret
            })
        }, 1000, { maxWait: 1000 })
        setError(undefined)
        setLoading(true)
        setConnecting(true)
        setInitializing(true)
        setList([])
        const src = apiEvents(cmd, objSameKeys(params, x => x === false ? undefined : x), (type, data) => {
            switch (type) {
                case 'connected':
                    setConnecting(false)
                    return setTimeout(() => apply.flush()) // this trick we'll cause first entries to be rendered almost immediately, while the rest will be subject to normal debouncing
                case 'error':
                    setError("Connection error")
                    setTimeout(reload, 1000)
                    return stop()
                case 'closed':
                    return stop()
                case 'msg':
                    const removeOnList: ReturnType<typeof _.matches>[] = []
                    const updateOnList: [object,object][] = []
                    wantArray(data).forEach(msg => {
                        if (!Array.isArray(msg))
                            return console.debug('illegal list packet', msg)
                        console.debug('LIST', ...msg)
                        const [op, par] = msg
                        if (op === LIST.ready) {
                            apply.flush()
                            setInitializing(false)
                            return
                        }
                        if (op === LIST.error) {
                            if (par === HTTP_UNAUTHORIZED)
                                state.loginRequired = msg[2]?.possible !== false || HTTP_FORBIDDEN
                            else
                                setError(err2msg(par))
                            return
                        }
                        if (op === LIST.props)
                            return setProps(par)
                        if (op === LIST.add) {
                            const mappedPar = map?.(par) ?? par
                            mappedPar.id ??= idGenerator.current = Math.max(idGenerator.current, Date.now()) + .001
                            bufferAdd.push(mappedPar)
                            apply()
                            return
                        }
                        if (op === LIST.remove) {
                            const match = _.matches(par)
                            if (_.isEmpty(_.remove(bufferAdd, match))) // first remove from the buffer
                                removeOnList.push(match)
                            return
                        }
                        if (op === LIST.update) {
                            const change = msg[2]
                            const found = _.find(bufferAdd, par)
                            if (found)
                                return Object.assign(found, change)
                            updateOnList.push([par, change])
                            return
                        }
                        console.debug('unknown list api', op)
                    })
                    setList(list => {
                        let ret = list
                        let copy // optimization: remember if we already made a copy
                        if (removeOnList.length) {
                            copy = list.filter(rec => !removeOnList.some(match1 => match1(rec)))
                            if (copy.length < list.length)  // avoid unnecessary render
                                ret = copy
                        }

                        if (updateOnList.length) {
                            for (const [search, change] of updateOnList) {
                                const foundAt = _.findIndex(ret, search)
                                if (foundAt < 0) continue
                                if (ret === list)
                                    ret = copy ?? list.slice()
                                ret[foundAt] = { ...ret[foundAt], ...change }
                            }
                        }
                        return ret
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
    return { list: pausedList ?? list, props, loading, error, initializing, connecting, setList, updateList, updateEntry, reload }

    function reload() {
        setReloader(x => x + 1)
    }

    function updateList(cb: (toModify: Draft<typeof list>) => void) {
        setList(produce(list, cb))
    }

    function updateEntry(search: T, change: T) {
        updateList(list => {
            const res = _.find(list, search as any)
            if (res)
                Object.assign(res, change)
        })
    }
}

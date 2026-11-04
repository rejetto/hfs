// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n'
import { Dict, err2msg, Falsy, LIST, useStateMounted, wantArray, xlate,
    HTTP_FORBIDDEN, HTTP_UNAUTHORIZED } from './misc'
import { IconBtn, spinner } from './mui'
import { Alert } from '@mui/material'
import _ from 'lodash'
import { state } from './state'
import { Refresh } from '@mui/icons-material'
import { produce, Draft } from 'immer'
import { ApiError, apiEvents, setDefaultApiCallOptions, useApi } from '@hfs/shared/api'
import { ApiHandler } from '../../src/apiMiddleware'
export * from '@hfs/shared/api'

setDefaultApiCallOptions({
    async onResponse(res: Response, body: any) {
        if (res.status === HTTP_UNAUTHORIZED) {
            state.loginRequired = body?.possible !== false || HTTP_FORBIDDEN
            throw new ApiError(res.status, body)
        }
    }
})

const ERRORS = { timeout: 'operation_timeout' }
// expand useApi with things that cannot be shared with Frontend
export type ApiObject<T extends ApiHandler=any> = ReturnType<typeof useApiEx<T>>
export function useApiEx<T extends ApiHandler=any>(...args: Parameters<typeof useApi>) {
    const res = useApi<T>(...args)
    return {
        ...res,
        element: useMemo(() =>
            !args[0] ? null
                : res.error ? h(Alert, { severity: 'error' }, t(xlate(String(res.error), ERRORS)),
                                    h(IconBtn, { icon: Refresh, title: t`Reload`, onClick: res.reload, sx: { m:'-10px 0 -8px 16px' } }) )
                    : res.data === undefined ? spinner()
                        : null,
            Object.values(res))
    }
}

export function useApiList<T=any, S=T>(cmd:string|Falsy, params: Dict={}, { map, invert, pause, limit, reconnectGraceSeconds=0 }: { reconnectGraceSeconds?: number, limit?: number, pause?: boolean, invert?: boolean, map?: (rec: S) => unknown }={}) {
    const [list, setList] = useStateMounted<T[]>([])
    const [props, setProps] = useStateMounted<any>(undefined)
    const [error, setError] = useStateMounted<any>(undefined)
    const [connecting, setConnecting] = useStateMounted(true)
    const [loading, setLoading] = useStateMounted(false)
    const [initializing, setInitializing] = useStateMounted(true)
    const [reloader, setReloader] = useState(0)
    const idGenerator = useRef(0)
    const limitRef = useRef(limit)
    limitRef.current = limit // changing the temporary UI limit must not reconnect and clear the list
    const [pausedList, setPausedList] = useState<typeof list | undefined>()
    useEffect(() => setPausedList(pause ? list : undefined), [pause])
    useEffect(() => {
        if (!cmd) return
        const command = cmd
        let disconnectedAt = 0
        let ready = false
        const bufferAdd: T[] = []
        const apply = _.debounce(() => {
            const chunk = bufferAdd.splice(0, Infinity)
            if (!chunk.length) return
            if (invert) chunk.reverse() // don't move this inside setList, as its callback can be called twice (and will, in dev)
            setList(list => {
                if (invert) {
                    const ret = [...chunk, ...list]
                    ret.splice(limitRef.current || Infinity, Infinity)
                    return ret
                }
                const ret = [...list, ...chunk]
                ret.splice(0, ret.length - (limitRef.current || Infinity))
                return ret
            })
        }, 1000, { maxWait: 1000 })
        let retry: ReturnType<typeof setTimeout>
        let close: () => void
        setList([])
        connect()

        function connect() {
            setError(undefined)
            setLoading(true)
            setConnecting(true)
            setInitializing(true)
            const skipInitial = ready && disconnectedAt > 0 && Date.now() - disconnectedAt <= reconnectGraceSeconds * 1000 // brief gaps may lose events; refresh restores snapshots without a replay buffer
            if (!skipInitial) {
                ready = false
                if (reconnectGraceSeconds !== Infinity) // infinite retention also preserves separately loaded history before the stream is ready
                    setList([])
            }
            const src = apiEvents(command, _.mapValues({ ...params, skipInitial }, x => x === false ? undefined : x), (type, data) => {
                switch (type) {
                    case 'connected':
                        if (skipInitial && Date.now() - disconnectedAt > reconnectGraceSeconds * 1000) { // a slow handshake can outlive the window even when the attempt started in time
                            src.close()
                            return connect()
                        }
                        setConnecting(false)
                        return setTimeout(() => apply.flush()) // this trick we'll cause first entries to be rendered almost immediately, while the rest will be subject to normal debouncing
                    case 'error':
                        setError("Connection error")
                        src.close()
                        disconnectedAt ||= Date.now() // failed retries must not extend the window
                        retry = setTimeout(connect, reconnectGraceSeconds > 0 ? Math.min(1000, reconnectGraceSeconds * 500) : 1000) // leave time for a retry within short retention windows
                        return stop()
                    case 'closed':
                        return stop()
                    case 'msg':
                        if (src.readyState !== src.OPEN)
                            return stop()
                        const removeOnList: ReturnType<typeof _.matches>[] = []
                        const updateOnList: [object,object][] = []
                        wantArray(data).forEach(msg => {
                            if (!Array.isArray(msg))
                                return console.debug('illegal list packet', msg)
                            console.debug('LIST', ...msg)
                            const [op, par] = msg
                            if (op === LIST.ready) {
                                ready = true
                                disconnectedAt = 0
                                apply.flush()
                                setInitializing(false)
                                return
                            }
                            if (op === LIST.error) {
                                if (par === HTTP_UNAUTHORIZED)
                                    state.loginRequired = msg[2]?.possible !== false || HTTP_FORBIDDEN
                                else
                                    setError(_.isString(par) || _.isNumber(par) ? err2msg(par) : par)
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
                                const change = map?.(msg[2]) ?? msg[2]
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
                }
            })

            close = () => src.close()
        }

        return () => {
            apply.cancel()
            // a retry belongs to this request and must not restart after its cleanup
            clearTimeout(retry)
            close()
        }

        function stop() {
            setConnecting(false)
            setInitializing(false)
            setLoading(false)
            apply.flush()
        }
    }, [reloader, cmd, JSON.stringify(params), reconnectGraceSeconds]) //eslint-disable-line
    const updateList = useCallback((cb: (toModify: Draft<typeof list>) => void) => setList(list => produce(list, cb)),
        [setList])
    const updateEntry = useCallback((search: T, change: T) => {
        updateList(list => {
            const res = _.find(list, search as any)
            if (res)
                Object.assign(res, change)
        })
    }, [updateList])
    const element = useMemo(() => connecting || initializing || loading ? spinner()
        : error ? h(Alert, { severity: 'error', sx: { flex: 1 } }, err2msg(error))
        : null,
        [connecting, initializing, loading, error])
    return {
        list: pausedList ?? list,
        props,
        loading,
        error,
        initializing,
        connecting,
        setList,
        updateList,
        updateEntry,
        reload,
        enabled: Boolean(cmd),
        element
    }

    function reload() {
        setReloader(x => x + 1)
    }
}

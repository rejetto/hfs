import { state, useSnapState } from './state'
import { useEffect, useRef, useState } from 'react'
import { apiCall, apiEvents } from './api'
import { DirList, usePath } from './BrowseFiles'

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const [list, setList] = useState<DirList>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error>()
    const lastPath = useRef('')
    useEffect(()=>{
        const loc = window.location
        if (!desiredPath.endsWith('/')) { // useful only in dev, while accessing the frontend directly without passing by the main server
            loc.href = loc.href + '/'
            return
        }
        const previous = lastPath.current
        lastPath.current = desiredPath
        state.stoppedSearch = false
        if (previous !== desiredPath && search) {
            state.remoteSearch = ''
            state.stopSearch?.()
            return
        }
        setLoading(true)

        ;(async ()=>{
            const API = 'file_list'
            const sse = search
            const baseParams = { path:desiredPath, search, sse, omit:'c' }
            let list: DirList = []
            setList(list)

            if (sse) { // buffering entries is necessary against burst of events that will hang the browser
                const buffer:DirList = []
                const flush = () => {
                    const chunk = buffer.splice(0, Infinity)
                    if (chunk.length)
                        setList(list = [...list, ...chunk])
                }
                const timer = setInterval(flush, 1000)
                const src = apiEvents(API, baseParams, (type, data) => {
                    switch (type) {
                        case 'error':
                            return setError(Error(JSON.stringify(data)))
                        case 'closed':
                            flush()
                            state.stopSearch?.()
                            return setLoading(false)
                        case 'msg':
                            if (src?.readyState === src?.CLOSED)
                                return state.stopSearch?.()
                            buffer.push(data.entry)
                    }
                })
                state.stopSearch = ()=>{
                    buffer.length = 0
                    setLoading(false)
                    clearInterval(timer)
                    state.stopSearch = undefined
                    src.close()
                }
                return
            }

            let offset = 0
            while (1) {
                const limit = list.length ? 1000 : 100
                const res = await apiCall(API, { ...baseParams, offset, limit }).catch(e => e)
                    || Error()
                if (res instanceof Error)
                    return setError(res)
                if (res.redirect) {
                    window.history.back() // cancel last piece of navigation that brought us here, we'll replace it with the following
                    loc.href = res.redirect
                }
                const chunk = res.list
                setList(list = [ ...list, ...chunk ])
                if (chunk.length < limit)
                    break
                offset = list.length
            }
            setLoading(false)
        })()
    }, [desiredPath, search])
    return { list, loading, error }
}


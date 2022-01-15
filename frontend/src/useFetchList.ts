import { state, useSnapState } from './state'
import { useEffect, useRef, useState } from 'react'
import { apiEvents } from './api'
import { DirEntry, DirList, usePath } from './BrowseFiles'
import { useForceUpdate } from './misc'

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const [list, setList] = useState<DirList>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error>()
    const lastPath = useRef('')
    const [reload, forcer] = useForceUpdate()

    // reorder in case sort criteria change
    const { sortBy, invertOrder, foldersFirst } = snap
    useEffect(()=>{
        setList(sort(list))
    }, [sortBy, invertOrder, foldersFirst]) //eslint-disable-line

    useEffect(()=>{
        if (!desiredPath.endsWith('/')) { // useful only in dev, while accessing the frontend directly without passing by the main server
            window.location.href = window.location.href + '/'
            return
        }
        const previous = lastPath.current
        lastPath.current = desiredPath
        if (previous !== desiredPath)
            state.stopSearch?.()
        state.stoppedSearch = false
        if (previous !== desiredPath && search) {
            state.remoteSearch = ''
            state.stopSearch?.()
            return
        }

        const API = 'file_list'
        const baseParams = { path:desiredPath, search, sse:true, omit:'c' }
        let list: DirList = []
        setList(list)
        setLoading(true)
        // buffering entries is necessary against burst of events that will hang the browser

        setError(undefined)
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                setList(list = sort([...list, ...chunk.map(precalculate)]))
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents(API, baseParams, (type, data) => {
            switch (type) {
                case 'error':
                    state.stopSearch?.()
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
    }, [desiredPath, search, snap.username, forcer])
    return {
        list, loading, error,
        reload() {
            state.remoteSearch = ''
            state.stopSearch?.()
            reload()
        }
    }
}

const { compare:localCompare } = new Intl.Collator(navigator.language)

function sort(list: DirList) {
    const { sortBy, foldersFirst } = state
    // optimization: precalculate string comparisons
    const bySize = sortBy === 'size'
    const byExt = sortBy === 'extension'
    const byTime = sortBy === 'time'
    const invert = state.invertOrder ? -1 : 1
    return list.sort((a,b) =>
        foldersFirst && -compare(a.isFolder, b.isFolder)
        || invert*(bySize ? compare(a.s||0, b.s||0)
            : byExt ? localCompare(a.ext, b.ext)
                : byTime ? compare(a.t, b.t)
                    : 0
        )
        || invert*localCompare(a.n, b.n) // fallback to name/path
    )
}

function precalculate(rec:DirEntry) {
    const i = rec.n.lastIndexOf('.') + 1
    rec.ext = i ? rec.n.substring(i) : ''
    rec.isFolder = rec.n.endsWith('/')
    const t = rec.m || rec.c
    if (t)
        rec.t = new Date(t)
    return rec
}

// generic comparison
function compare(a:any, b:any) {
    return a < b ? -1 : a > b ? 1 : 0
}

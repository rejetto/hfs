import { state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiEvents } from './api'
import { DirEntry, DirList, usePath } from './BrowseFiles'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const lastPath = useRef('')

    useEffect(()=>{
        if (!desiredPath.endsWith('/')) { // useful only in dev, while accessing the frontend directly without passing by the main server
            window.location.href = window.location.href + '/'
            return
        }
        const previous = lastPath.current
        lastPath.current = desiredPath
        if (previous !== desiredPath) {
            state.showFilter = false
            state.stopSearch?.()
        }
        state.stoppedSearch = false
        if (previous !== desiredPath && search) {
            state.remoteSearch = ''
            return
        }

        const API = 'file_list'
        const baseParams = { path:desiredPath, search, sse:true, omit:'c' }
        state.list = []
        state.filteredList = undefined
        state.selected = {}
        state.loading = true
        state.error = null
        // buffering entries is necessary against burst of events that will hang the browser
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                state.list = sort([...state.list, ...chunk.map(precalculate)])
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents(API, baseParams, (type, data) => {
            switch (type) {
                case 'error':
                    state.stopSearch?.()
                    return state.error = Error(JSON.stringify(data))
                case 'closed':
                    flush()
                    state.stopSearch?.()
                    return state.loading = false
                case 'msg':
                    if (src?.readyState === src?.CLOSED)
                        return state.stopSearch?.()
                    buffer.push(data.entry)
            }
        })
        state.stopSearch = ()=>{
            state.stopSearch = undefined
            buffer.length = 0
            state.loading = false
            clearInterval(timer)
            src.close()
        }
    }, [desiredPath, search, snap.username, snap.listReloader])
}

export function reloadList() {
    state.listReloader = Date.now()
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

// update list on sorting criteria
const sortAgain = _.debounce(()=> state.list = sort(state.list), 100)
subscribeKey(state, 'sortBy', sortAgain)
subscribeKey(state, 'invertOrder', sortAgain)
subscribeKey(state, 'foldersFirst', sortAgain)

subscribeKey(state, 'patternFilter', v => {
    if (!v)
        return state.filteredList = undefined
    const filter = new RegExp(_.escapeRegExp(v),'i')
    const newList = []
    for (const entry of state.list)
        if (filter.test(entry.n))
            newList.push(entry)
    state.filteredList = newList
})

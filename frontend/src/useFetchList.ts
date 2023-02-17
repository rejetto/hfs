// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiEvents } from './api'
import { DirEntry, DirList, usePath } from './BrowseFiles'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { useIsMounted } from 'usehooks-ts'
import { alertDialog } from './dialog'
import { ERRORS } from './misc'

const API = 'file_list'

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const lastPath = useRef('')
    const lastReq = useRef<any>()
    const isMounted = useIsMounted()
    useEffect(()=>{
        if (snap.loginRequired) return
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

        const baseParams = { path:desiredPath, search, sse:true, omit:'c' }
        if (_.isEqual(baseParams, lastReq.current)) return
        lastReq.current = baseParams

        state.list = []
        state.filteredList = undefined
        state.selected = {}
        state.loading = true
        state.error = undefined
        state.can_upload = undefined
        state.can_delete = undefined
        // buffering entries is necessary against burst of events that will hang the browser
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length)
                state.list = sort([...state.list, ...chunk.map(precalculate)])
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents(API, baseParams, (type, data) => {
            if (!isMounted()) return
            switch (type) {
                case 'error':
                    state.stopSearch?.()
                    state.error = "connection error"
                    lastReq.current = null
                    return
                case 'closed':
                    flush()
                    state.stopSearch?.()
                    state.loading = false
                    lastReq.current = undefined
                    return
                case 'msg':
                    data.forEach(async (entry: any) => {
                        if (entry.props)
                            return Object.assign(state, _.pick(entry.props, ['can_upload', 'can_delete']))
                        state.can_upload ??= false
                        state.can_delete ??= false
                        if (entry.add)
                            return buffer.push(entry.add)
                        const { error } = entry
                        if (error === 405) { // "method not allowed" happens when we try to directly access an unauthorized file, and we get a login prompt, and then file_list the file (because we didn't know it was file or folder)
                            state.messageOnly = "Your download should now start"
                            window.location.reload() // reload will start the download, because now we got authenticated
                            return
                        }
                        if (error) {
                            state.stopSearch?.()
                            state.error = (ERRORS as any)[error] || String(error)
                            if (error === 401)
                                await alertDialog("This account has no access, try another", 'warning')
                            state.loginRequired = error === 401
                            lastReq.current = null
                            return
                        }
                    })
                    if (src?.readyState === src?.CLOSED)
                        return state.stopSearch?.()
            }
        })
        state.stopSearch = ()=>{
            state.stopSearch = undefined
            buffer.length = 0
            state.loading = false
            clearInterval(timer)
            src.close()
        }
    }, [desiredPath, search, snap.username, snap.listReloader, snap.loginRequired])
}

export function reloadList() {
    state.listReloader = Date.now()
}

const { compare:localCompare } = new Intl.Collator(navigator.language)

function sort(list: DirList) {
    const { sortBy, foldersFirst, sortNumerics } = state
    // optimization: precalculate string comparisons
    const bySize = sortBy === 'size'
    const byExt = sortBy === 'extension'
    const byTime = sortBy === 'time'
    const invert = state.invertOrder ? -1 : 1
    return list.sort((a,b) =>
        foldersFirst && -compare(a.isFolder, b.isFolder)
        || invert * (bySize ? compare(a.s||0, b.s||0)
            : byExt ? localCompare(a.ext, b.ext)
                : byTime ? compare(a.t, b.t)
                    : 0
        )
        || sortNumerics && (invert * compare(parseFloat(a.n), parseFloat(b.n)))
        || invert * localCompare(a.n, b.n) // fallback to name/path
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
subscribeKey(state, 'sortNumerics', sortAgain)

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

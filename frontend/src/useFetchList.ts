// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiEvents } from '@hfs/shared/api'
import { DirList } from './BrowseFiles'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { useIsMounted } from 'usehooks-ts'
import { alertDialog } from './dialog'
import { ERRORS } from './misc'
import { t } from './i18n'
import { useLocation, useNavigate } from 'react-router-dom'

const RELOADER_PROP = Symbol('reloader')

export function usePath() {
    return useLocation().pathname
}

export function pathEncode(s: string) {
    return encodeURI(s).replace(/#/g, encodeURIComponent)
}

export function pathDecode(s: string) {
    return decodeURI(s).replace(/%23/g, '#')
}

export default function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const lastPath = useRef('')
    const lastReq = useRef<any>()
    const isMounted = useIsMounted()
    const navigate = useNavigate()
    useEffect(()=>{
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

        const baseParams = {
            uri: desiredPath,
            search,
            sse: true,
            omit: 'c',
            [RELOADER_PROP]: snap.listReloader, // symbol, so it won't be serialized, but will force reloading
        }
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
                state.list = sort([...state.list, ...chunk])
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents('file_list', baseParams, (type, data) => {
            if (!isMounted()) return
            switch (type) {
                case 'error':
                    state.stopSearch?.()
                    state.error = t`connection error`
                    lastReq.current = null
                    return
                case 'closed':
                    flush()
                    state.stopSearch?.()
                    state.loading = false
                    return
                case 'msg':
                    state.loginRequired = false
                    for (const entry of data) {
                        const { error } = entry
                        if (error === 405) { // "method not allowed" happens when we try to directly access an unauthorized file, and we get a login prompt, and then file_list the file (because we didn't know it was file or folder)
                            state.messageOnly = t('upload_starting', "Your download should now start")
                            window.location.reload() // reload will start the download, because now we got authenticated
                            continue
                        }
                        if (error) {
                            state.stopSearch?.()
                            state.error = (ERRORS as any)[error] || String(error)
                            if (error === 401 && snap.username)
                                alertDialog(t('wrong_account', { u: snap.username }, "Account {u} has no access, try another"), 'warning').then()
                            state.loginRequired = error === 401
                            lastReq.current = null
                            continue
                        }
                        if (!desiredPath.endsWith('/'))  // now we know it was a folder for sure
                            return navigate(desiredPath + '/')
                        if (entry.props) {
                            Object.assign(state, _.pick(entry.props, ['can_upload', 'can_delete', 'accept']))
                            continue
                        }
                        state.can_upload ??= false
                        state.can_delete ??= false
                        const { add } = entry
                        if (add) {
                            add.uri = pathEncode(add.n)
                            add.isFolder = add.n.endsWith('/')
                            if (add.isFolder) {
                                const i = add.n.lastIndexOf('.') + 1
                                add.ext = i ? add.n.substring(i) : ''
                            }
                            const t = add.m || add.c
                            if (t)
                                add.t = new Date(t)
                            add.name = add.isFolder ? add.n.slice(add.n.lastIndexOf('/', add.n.length - 2) +1, -1)
                                : add.n.slice(add.n.lastIndexOf('/') + 1)
                            add.cantOpen = add.p?.includes(add.isFolder ? 'l' : 'r')  // to open we need list for folders and read for files

                            buffer.push(add)
                        }
                    }
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

// generic comparison
function compare(a:any, b:any) {
    return a < b ? -1 : a > b ? 1 : 0
}

// update list on sorting criteria
const sortAgain = _.debounce(()=> state.list = sort(state.list), 100)
for (const k of [ 'sortBy', 'invertOrder', 'foldersFirst', 'sortNumerics'] as const)
    subscribeKey(state, k, sortAgain)

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

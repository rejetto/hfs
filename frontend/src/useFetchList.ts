// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { DirEntry, DirList, state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiEvents } from '@hfs/shared/api'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { useIsMounted } from 'usehooks-ts'
import { alertDialog } from './dialog'
import { HTTP_MESSAGES, xlate } from './misc'
import { t } from './i18n'
import { useLocation, useNavigate } from 'react-router-dom'

export function usePath() {
    return useLocation().pathname
}

export default function useFetchList() {
    const snap = useSnapState()
    const uri = usePath() // this api can still work removing the initial slash, but then we'll have a mixed situation that will require plugins an extra effort
    const search = snap.remoteSearch || undefined
    const lastUri = useRef('')
    const lastReq = useRef<any>()
    const lastReloader = useRef(snap.listReloader)
    const isMounted = useIsMounted()
    const navigate = useNavigate()
    useEffect(()=>{
        const previous = lastUri.current
        lastUri.current = uri
        if (previous !== uri) {
            state.showFilter = false
            state.stopSearch?.()
        }
        state.stoppedSearch = false
        if (previous !== uri && search) {
            state.remoteSearch = ''
            return
        }

        const params = { uri, search }
        if (snap.listReloader === lastReloader.current && _.isEqual(params, lastReq.current)) return
        lastReq.current = params
        lastReloader.current = snap.listReloader

        state.list = []
        state.filteredList = undefined
        state.selected = {}
        state.loading = true
        state.error = undefined
        state.props = undefined
        // buffering entries is necessary against burst of events that will hang the browser
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (chunk.length) {
                state.list = sort([...state.list, ...chunk])
                updateFilteredList()
            }
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents('get_file_list', params, (type, data) => {
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
                        if (!Array.isArray(entry)) continue // unexpected
                        const [op, par] = entry
                        const error = op === 'error' && par
                        if (error === 405) { // "method not allowed" happens when we try to directly access an unauthorized file, and we get a login prompt, and then get_file_list the file (because we didn't know it was file or folder)
                            state.messageOnly = t('upload_starting', "Your download should now start")
                            window.location.reload() // reload will start the download, because now we got authenticated
                            continue
                        }
                        if (error) {
                            state.stopSearch?.()
                            state.error = xlate(error, HTTP_MESSAGES)
                            if (error === 401 && snap.username)
                                alertDialog(t('wrong_account', { u: snap.username }, "Account {u} has no access, try another"), 'warning').then()
                            state.loginRequired = error === 401
                            lastReq.current = null
                            continue
                        }
                        if (uri && !uri.endsWith('/'))  // now we know it was a folder for sure
                            return navigate(uri + '/')
                        if (op === 'props') {
                            state.props = par
                            continue
                        }
                        if (op === 'add')
                            buffer.push(new DirEntry(par.n, par))
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
    }, [uri, search, snap.username, snap.listReloader, snap.loginRequired])
}

export function reloadList() {
    state.listReloader = Date.now()
}

const { compare: localCompare } = new Intl.Collator(navigator.language)

function sort(list: DirList) {
    const { sort_by, folders_first, sort_numerics } = state
    // optimization: precalculate string comparisons
    const bySize = sort_by === 'size'
    const byExt = sort_by === 'extension'
    const byTime = sort_by === 'time'
    const invert = state.invert_order ? -1 : 1
    return list.sort((a,b) =>
        folders_first && -compare(a.isFolder, b.isFolder)
        || invert * (bySize ? compare(a.s||0, b.s||0)
            : byExt ? localCompare(a.ext, b.ext)
                : byTime ? compare(a.t, b.t)
                    : 0
        )
        || sort_numerics && (invert * compare(parseFloat(a.n), parseFloat(b.n)))
        || invert * localCompare(a.n, b.n) // fallback to name/path
    )
}

// generic comparison
function compare(a:any, b:any) {
    return a < b ? -1 : a > b ? 1 : 0
}

// update list on sorting criteria
const sortAgain = _.debounce(()=> state.list = sort(state.list), 100)
for (const k of [ 'sort_by', 'invert_order', 'folders_first', 'sort_numerics'] as const)
    subscribeKey(state, k, sortAgain)

subscribeKey(state, 'patternFilter', updateFilteredList)
function updateFilteredList() {
    const v = state.patternFilter
    if (!v)
        return state.filteredList = undefined
    const filter = new RegExp(_.escapeRegExp(v),'i')
    state.filteredList = state.list.filter(x => filter.test(x.n))
}
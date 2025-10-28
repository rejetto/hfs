// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { DirEntry, DirList, state, useSnapState } from './state'
import { useEffect, useRef } from 'react'
import { apiCall, apiEvents } from '@hfs/shared/api'
import _ from 'lodash'
import { subscribeKey } from 'valtio/utils'
import { useIsMounted } from 'usehooks-ts'
import { alertDialog } from './dialog'
import {
    hfsEvent, LIST, urlParams, xlate, objFromKeys, getHFS,
    HTTP_MESSAGES, HTTP_METHOD_NOT_ALLOWED, HTTP_UNAUTHORIZED,
} from './misc'
import { useLocation, useNavigate } from 'react-router-dom'
import { closeLoginDialog } from './login'
import { fileShow, getShowComponent } from './show'
import i18n from './i18n'
const { t } = i18n

export function usePath() {
    return useLocation().pathname
}

// allow links with ?search
let firstListRequest: any
setTimeout(() => {// wait, urlParams is defined at top level
    state.remoteSearch = urlParams.search ? { search: urlParams.search } : undefined
    firstListRequest = objFromKeys(['onlyFiles', 'onlyFolders'], x => x in urlParams || undefined)
})

let autoPlayOnce: string | undefined = urlParams.autoplay // this will be consumed, so to only act once

export default function useFetchList() {
    const snap = useSnapState()
    const uri = usePath() // this api can still work removing the initial slash, but then we'll have a mixed situation that will require plugins an extra effort
    const {remoteSearch} = snap
    const lastUri = useRef('')
    const lastParams = useRef<any>()
    const lastReloader = useRef(snap.listReloader)
    const isMounted = useIsMounted()
    const navigate = useNavigate()
    const { loginRequired=false } = snap // undefined=false
    useEffect(()=>{
        const previous = lastUri.current
        lastUri.current = uri
        if (previous !== uri) {
            state.uri = uri // this should be a better way than uriChanged
            state.showFilter = false
            state.stopSearch?.()
        }
        state.searchManuallyInterrupted = false
        if (previous && previous !== uri && remoteSearch) {
            state.remoteSearch = undefined
            return
        }

        const params = { uri, ...remoteSearch, ...firstListRequest }
        if (snap.listReloader === lastReloader.current && _.isEqual(params, lastParams.current)) return
        lastParams.current = params
        lastReloader.current = snap.listReloader

        state.list = []
        state.selected = {}
        state.loading = true
        state.error = undefined
        state.props = undefined
        // while 'play' needs to wait for the whole list to be available (and sorted) to proceed in order, 'playShuffle' can start right away, and it's important it does because a ?search may take long
        let play = false
        let playShuffle = false
        // buffering entries is necessary against burst of events that will hang the browser
        const buffer: DirList = []
        const flush = () => {
            const chunk = buffer.splice(0, Infinity)
            if (!chunk.length) return
            hfsEvent('newListEntries', { entries: chunk })
            state.list = sort([...state.list, ...chunk])
            if (playShuffle) // find first proper file, and play it
                for (const x of chunk)
                    if (getShowComponent(x)) {
                        fileShow(x, { startPlaying: true, startShuffle: true })
                        playShuffle = false
                        break
                    }
        }
        const timer = setInterval(flush, 1000)
        const src = apiEvents('get_file_list', params, (type, data) => {
            if (!isMounted()) return
            switch (type) {
                case 'connected':
                    if (autoPlayOnce === '') play = true
                    if (autoPlayOnce === 'shuffle') playShuffle = true
                    autoPlayOnce = undefined
                    firstListRequest = undefined
                    return
                case 'error':
                    state.stopSearch?.()
                    state.error = t`connection error`
                    lastParams.current = null
                    return
                case 'closed':
                    flush()
                    state.stopSearch?.()
                    state.loading = false
                    if (play)
                        for (const x of state.list)
                            if (getShowComponent(x)) {
                                fileShow(x, { startPlaying: true })
                                play = false
                                break
                            }
                    return
                case 'msg':
                    const showLogin = location.hash === '#LOGIN'
                    if (closeLoginDialog)
                        location.hash = ''
                    state.loginRequired = showLogin
                    for (const entry of data) {
                        if (!Array.isArray(entry)) continue // unexpected
                        const [op, par] = entry
                        const error = op === LIST.error && par
                        // "method not allowed" happens when we try to directly access an unauthorized file, and we get a login prompt, and then get_file_list the file (because we didn't know it was file or folder)
                        // it also happens accessing a web-page folder, and the reload is the right solution too.
                        if (error === HTTP_METHOD_NOT_ALLOWED) {
                            state.messageOnly = t('download_starting', "Your download should now start")
                            window.location.reload() // reload will start the download, because now we got authenticated
                            continue
                        }
                        if (error) {
                            state.stopSearch?.()
                            state.error = xlate(error, HTTP_MESSAGES)
                            if (error === HTTP_UNAUTHORIZED && snap.username)
                                apiCall('refresh_session').then(x => {
                                    if (x.username) // check if username was actually considered (or instead session was refused)
                                        void alertDialog(t('wrong_account', { u: snap.username }, "Account {u} has no access, try another"), 'warning')
                                })
                            state.loginRequired = error === HTTP_UNAUTHORIZED
                            lastParams.current = null
                            continue
                        }
                        if (uri && !uri.endsWith('/'))  // now we know it was a folder for sure
                            return navigate(uri + '/')
                        if (op === LIST.props) {
                            state.props = par
                            continue
                        }
                        if (op === LIST.add)
                            buffer.push(new DirEntry(par.n, par))
                    }
                    if (src.readyState === src.CLOSED)
                        return state.stopSearch?.()
            }
        })
        state.stopSearch = () => {
            state.stopSearch = undefined
            buffer.length = 0
            state.loading = false
            clearInterval(timer)
            src.close()
        }
        return () => {
            state.stopSearch?.()
            lastParams.current = null
        }
    }, [uri, remoteSearch, snap.username, snap.listReloader, loginRequired])
}

export function reloadList() {
    state.listReloader = Date.now()
}

getHFS().textSortCompare = new Intl.Collator(navigator.language, { sensitivity: 'base' }).compare // expose it, so that it can be overridden

function sort(list: DirList) {
    const { sort_by, folders_first, sort_numerics } = state
    // optimization: precalculate string comparisons
    const bySize = sort_by === 'size'
    const byExt = sort_by === 'extension'
    const byTime = sort_by === 'time'
    const byCreation = sort_by === 'creation'
    const invert = state.invert_order ? -1 : 1
    const {textSortCompare} = getHFS()
    return list.sort((a, b) =>
        -compareScalar(a.order||0, b.order||0)
        || hfsEvent('sortCompare', { a, b }).find(Boolean)
        || folders_first && -compareScalar(a.isFolder, b.isFolder)
        || invert * (bySize ? compareScalar(a.s||0, b.s||0)
            : byExt ? textSortCompare(a.ext, b.ext)
                : byTime ? compareScalar(a.m, b.m)
                    : byCreation ? compareScalar(a.c, b.c)
                        : 0
        )
        || sort_numerics && (invert * compareNumerics(a.n, b.n))
        || invert * textSortCompare(a.n, b.n) // fallback to name/path
    )

    function compareNumerics(a: string, b: string) {
        const re = /\d/g
        if (!re.exec(a)) return 0
        const i = re.lastIndex
        if (i) { // doesn't start with a number
            if (!b.startsWith(a.slice(0, i -1))) return 0 // b is comparable only if it has same leading part
            a = a.slice(i-1)
            b = b.slice(i-1)
        }
        return compareScalar(parseFloat(a), parseFloat(b))
    }
}

function compareScalar(a:any, b:any) {
    return a - b
}

// update list on sorting criteria
const sortAgain = _.debounce(()=> state.list = sort(state.list), 100)
for (const k of [ 'sort_by', 'invert_order', 'folders_first', 'sort_numerics'] as const)
    subscribeKey(state, k, sortAgain)

const updateFilteredList = _.debounce(() => {
    const v = state.patternFilter
    if (!v)
        return state.filteredList = undefined
    const filter = new RegExp(_.escapeRegExp(v),'i')
    state.filteredList = state.list.filter(x => filter.test(x.n))
})
subscribeKey(state, 'list', updateFilteredList)
subscribeKey(state, 'patternFilter', updateFilteredList)

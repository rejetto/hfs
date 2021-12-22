import { Link, useLocation } from 'react-router-dom'
import { apiCall, apiEvents } from './api'
import { createContext, createElement as h, Fragment, useContext, useEffect, useRef, useState } from 'react'
import { formatBytes, hError, hIcon } from './misc'
import { Spinner } from './components'
import { Head } from './Head'
import { state, useSnapState } from './state'
import _ from 'lodash'

function usePath() {
    return decodeURI(useLocation().pathname)
}

interface DirEntry { n:string, s?:number, m?:string, c?:string }
export type DirList = DirEntry[]
interface ListRes { list:DirList, unfinished?:boolean, err?:Error }

export const ListContext = createContext<ListRes>({ list:[], unfinished: false })

export function BrowseFiles() {
    const { list, unfinished, error } = useFetchList()
    if (error)
        return hError(error)
    if (!list)
        return h(Spinner)
    return h(ListContext.Provider, { value:{ list, unfinished } },
        h(Head),
        h(FilesList))
}

function useFetchList() {
    const snap = useSnapState()
    const desiredPath = usePath()
    const search = snap.remoteSearch || undefined
    const [list, setList] = useState<DirList>([])
    const [unfinished, setUnfinished] = useState(true)
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
        if (previous !== desiredPath && search) {
            state.remoteSearch = ''
            state.stopSearch?.()
            return
        }

        ;(async ()=>{
            const API = 'file_list'
            const sse = search
            const baseParams = { path:desiredPath, search, sse, omit:'c' }
            let list: DirList = []
            setUnfinished(true)
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
                            clearInterval(timer)
                            flush()
                            return setUnfinished(false)
                        case 'msg':
                            if (src?.readyState === src?.CLOSED)
                                return state.stopSearch?.()
                            let { entry } = data
                            console.log(entry.n)
                            buffer.push(entry)
                    }
                })
                state.stopSearch = ()=>{
                    buffer.length = 0
                    clearInterval(timer)
                    state.stopSearch = undefined
                    src.close()
                }
                return
            }

            let offset = 0
            while (1) {
                const limit = list.length ? 1000 : 100
                const res = await apiCall(API, { ...baseParams, offset, limit })
                    || Error()
                if (res instanceof Error)
                    return setError(res)
                const chunk = res.list
                setList(list = [ ...list, ...chunk ])
                if (chunk.length < limit)
                    break
                offset = list.length
            }
            setUnfinished(false)
        })()
    }, [desiredPath, search])
    return { list, unfinished, error }
}

function FilesList() {
    const { list, unfinished } = useContext(ListContext)
    const snap = useSnapState()
    if (!list) return null
    const filter = snap.listFilter > '' && new RegExp(_.escapeRegExp(snap.listFilter),'i')
    let n = 0 // if I try to use directly the state as counter I get a "too many re-renders" error
    const ret = h('ul', { className: 'dir' },
        !list.length ? (unfinished || 'Nothing here')
            : list.map((entry: DirEntry) =>
                h(File, { key: entry.n, hidden: filter && !filter.test(entry.n) || !++n, ...entry })),
        unfinished && h(Spinner))
    state.filteredEntries = filter ? n : -1
    return ret
}

function File({ n, m, c, s, hidden }: DirEntry & { hidden:boolean }) {
    const base = usePath()
    const isDir = n.endsWith('/')
    const t = m||c ||null
    const href = n.replace(/#/g, encodeURIComponent)
    return h('li', { style:hidden ? { display:'none' } : null },
        isDir ? h(Link, { to: base+href }, hIcon('folder'), n)
            : h('a', { href }, hIcon('file'), n),
        h('div', { className:'entry-props' },
            s !== undefined && h(Fragment, {},
                h('span', { className:'entry-size' }, formatBytes(s)),
                hIcon('download'),
            ),
            t && h('span', { className:'entry-ts' }, new Date(t).toLocaleString()),
        ),
        h('div', { style:{ clear:'both' } })
    )
}

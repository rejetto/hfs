import { createElement as h, useEffect, useState } from 'react'
import { proxy, useSnapshot } from 'valtio'
import { apiCall, apiEvents } from '@hfs/shared/api'
import { EXTRACT_EXTENSIONS, ExtractionJob } from '../../src/cross-const'
import { DirEntry, state, useSnapState } from './state'
import { alertDialog, confirmDialog, newDialog, promptDialog } from './dialog'
import { Btn } from './components'
import { reloadList } from './useFetchList'
import i18n from './i18n'
const { t } = i18n
const STORAGE_KEY = 'hfs-extractions'
const startedHere = new Set<string>()
const extractionState = proxy({ ids: readIds(), jobs: [] as ExtractionJob[], error: '' })

function readIds(): string[] {
    try {
        const ids = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')
        return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : []
    }
    catch { return [] }
}

function saveIds(ids: string[]) {
    extractionState.ids = ids
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids)) }
    catch {} // the in-memory credential still works if browser storage is unavailable
}

export function canExtract(entry: DirEntry) {
    // search results can belong to folders whose permissions are not in state.props
    return !entry.isFolder && !entry.cantOpen
        && decodeURI(entry.uri.slice(0, entry.uri.lastIndexOf('/') + 1)) === decodeURI(location.pathname)
        && EXTRACT_EXTENSIONS.includes(entry.name.split('.').pop()!.toLowerCase())
        && state.props?.can_upload && state.props?.can_delete_children
}

export async function extractArchive(entry: DirEntry) {
    const dest = await promptDialog(t`Destination folder`, {
        title: t`Extract`, value: entry.name.replace(/\.[^.]+$/, ''),
        helperText: t`Leave empty to extract next to the archive`,
    })
    if (dest === undefined || !await confirmDialog(t`Existing files will be overwritten. Files you cannot delete will be skipped.`)) return false
    const { id } = await apiCall('extract_archive', { uri: entry.uri, dest })
    startedHere.add(id)
    saveIds([...extractionState.ids, id])
    showExtractions()
}

export function useExtractionProgress(uri: string | undefined) {
    const [progress, setProgress] = useState<{ progress?: number, status?: ExtractionJob['status'] }>({})
    useEffect(() => {
        if (!uri) return
        const stream = apiEvents('get_extraction_progress', { uri }, (type, messages) => {
            if (type !== 'msg') return
            for (const [op, value] of messages)
                if (op === 'props') // keep the result of a job seen running in this menu; reopening offers Extract again
                    setProgress(previous => value.status && (value.status === 'running' || previous.status) ? value : previous)
        })
        return () => stream.close()
    }, [uri])
    return progress
}

export function ExtractionIndicator() {
    const { username, adminUrl } = useSnapState()
    const { ids, jobs, error } = useSnapshot(extractionState)
    const idsKey = JSON.stringify(ids)
    useEffect(() => {
        extractionState.jobs = []
        extractionState.error = ''
        if (!username && !adminUrl && !ids.length) return
        let closed = false, stream: ReturnType<typeof apiEvents> | undefined
        let request: ReturnType<typeof apiCall>, timer: ReturnType<typeof setTimeout> | undefined
        connect()
        return () => { closed = true; clearTimeout(timer); request.abort(); stream?.close() }

        function connect() {
            // POST recovers oversized old sessions; keep polling if even the live credentials cannot fit a short SSE URL
            request = apiCall('get_extractions', { ids: idsKey })
            void request.then(({ jobs }) => {
                if (stale()) return
                receive(jobs)
                if (stale()) return
                if (idsKey.length > 4000) {
                    timer = setTimeout(connect, 500)
                    return
                }
                stream = apiEvents('get_extractions', { ids: idsKey }, (type, messages) => {
                    if (stale()) return
                    if (type === 'error') extractionState.error = t`connection error`
                    if (type !== 'msg') return
                    for (const [op, value] of messages)
                        if (op === 'props') receive(value.jobs)
                })
            }).catch(() => {
                if (stale()) return
                extractionState.error = t`connection error`
                timer = setTimeout(connect, 3000) // retain automatic reconnection when the bootstrap request fails
            })
        }

        function stale() {
            // a snapshot requested before a new job or login must not discard its credential
            return closed || idsKey !== JSON.stringify(extractionState.ids)
                || username !== state.username || adminUrl !== state.adminUrl
        }
        function receive(next: ExtractionJob[]) {
            extractionState.error = ''
            // include jobs that finish before the first SSE snapshot; only the requester gets a folder refresh
            const refresh = next.some(job => job.status !== 'running'
                && (startedHere.has(job.id) || extractionState.jobs.some(previous => previous.id === job.id && previous.status === 'running'))
                && (job.username ? job.username === username : ids.includes(job.id))
                && [job.destination, job.uri.slice(0, job.uri.lastIndexOf('/') + 1)].some(uri => decodeURI(uri) === decodeURI(location.pathname)))
            for (const job of next)
                if (job.status !== 'running') startedHere.delete(job.id)
            extractionState.jobs = next
            if (refresh) reloadList()
            const retained = ids.filter(id => next.some(job => job.id === id && !job.username))
            if (retained.length !== ids.length) saveIds(retained)
        }
    }, [username, adminUrl, idsKey])
    const running = jobs.filter(job => job.status === 'running')
    return (jobs.length > 0 || error) && h(Btn, {
        id: 'extraction-indicator', className: 'small', icon: 'archive',
        label: running.length ? `${Math.max(...running.map(job => job.progress))}%${running.length > 1 ? ` (${running.length})` : ''}` : t`Extractions`,
        tooltip: t`Extractions`, onClick: showExtractions,
    })
}

export function extractionStatusLabel(status: ExtractionJob['status']) {
    return status === 'running' ? t`Extracting` : status === 'done' ? t`Completed` : status === 'stopped' ? t`Stopped` : t`Error`
}

function showExtractions() {
    newDialog({ title: t`Extractions`, className: 'extractions-dialog', Content: ExtractionDetails })
}

function ExtractionDetails() {
    const { jobs, error } = useSnapshot(extractionState)
    const [selected, setSelected] = useState('')
    const job = jobs.find(job => job.id === selected) || jobs.at(-1)
    const { t } = i18n.useI18N()
    return h('div', {},
        error && h('p', { role: 'alert' }, error),
        h('div', { role: 'tablist', 'aria-label': t`Extractions`, style: { display: 'flex', overflowX: 'auto' } },
            ...jobs.map((item, index) => h('button', {
                key: item.id, role: 'tab', id: `extraction-tab-${item.id}`,
                'aria-selected': item.id === job?.id, 'aria-controls': 'extraction-details',
                tabIndex: item.id === job?.id ? 0 : -1,
                onKeyDown(ev) {
                    const next = ev.key === 'ArrowRight' ? (index + 1) % jobs.length
                        : ev.key === 'ArrowLeft' ? (index + jobs.length - 1) % jobs.length
                            : ev.key === 'Home' ? 0 : ev.key === 'End' ? jobs.length - 1 : undefined
                    if (next === undefined) return
                    ev.preventDefault()
                    const id = jobs[next].id
                    setSelected(id)
                    document.getElementById(`extraction-tab-${id}`)?.focus()
                },
                onClick: () => setSelected(item.id),
            }, decodeURI(item.uri.split('/').pop()!))) ),
        job ? h('div', { role: 'tabpanel', id: 'extraction-details', 'aria-labelledby': `extraction-tab-${job.id}` },
            h('p', {}, decodeURI(job.uri)),
            h('p', {}, t`Destination folder`, ': ', decodeURI(job.destination)),
            h('progress', { max: 100, value: job.progress, 'aria-label': t`Extract` }),
            ` ${job.progress}% — ${extractionStatusLabel(job.status)}`,
            job.status === 'running' && h(Btn, { label: t`Stop`, icon: 'stop', async onClick() {
                try { await apiCall('stop_extraction', { id: job.id }) }
                catch (e) { alertDialog(e instanceof Error ? e : String(e)) }
            } }),
            job.error && h('p', { role: 'alert' }, job.error),
            h('p', {}, `${t`Extracted`}: ${job.extracted} — ${t`Skipped`}: ${job.skipped}`),
            job.truncated && h('p', {}, t`Only the last 100 entries are shown`),
            h('ul', { style: { maxHeight: '35vh', overflow: 'auto', overflowWrap: 'anywhere' } },
                ...job.entries.map((entry, i) => h('li', { key: i }, entry.skipped ? `${t`Skipped`}: ` : '', entry.path)) ),
        ) : h('p', {}, t`No extractions`),
    )
}

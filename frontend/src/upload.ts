// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, DragEvent, Fragment, useMemo, CSSProperties, useState, useEffect } from 'react'
import { Btn, Flex, FlexV, iconBtn, Select } from './components'
import {
    basename, closeDialog, formatBytes, formatPerc, hIcon, useIsMobile, newDialog, prefix, selectFiles, working,
    HTTP_CONFLICT, HTTP_PAYLOAD_TOO_LARGE, formatSpeed, dirname, getHFS, onlyTruthy, with_, cpuSpeedIndex,
    buildUrlQueryString, randomId, HTTP_MESSAGES, pathEncode, pendingPromise,
} from './misc'
import _ from 'lodash'
import { INTERNAL_Snapshot, proxy, ref, snapshot, subscribe, useSnapshot } from 'valtio'
import { alertDialog, confirmDialog, promptDialog, toast } from './dialog'
import { reloadList } from './useFetchList'
import { apiCall, getNotifications } from '@hfs/shared/api'
import { state, useSnapState } from './state'
import { Link } from 'react-router-dom'
import { t } from './i18n'
import { subscribeKey } from 'valtio/utils'
import { LinkClosingDialog } from './fileMenu'

const renameEnabled = getHFS().dontOverwriteUploading

interface ToUpload { file: File, comment?: string, name?: string, to?: string, error?: string }
export const uploadState = proxy<{
    done: ToUpload[]
    doneByte: number
    errors: ToUpload[]
    skipped: ToUpload[]
    adding: ToUpload[]
    qs: { to: string, entries: ToUpload[] }[]
    paused: boolean
    uploading?: ToUpload
    progress: number // percentage
    partial: number // relative to uploading file. This is how much we have done of the current queue.
    speed: number
    eta: number
}>({
    eta: 0,
    speed: 0,
    partial: 0,
    progress: 0,
    paused: false,
    qs: [],
    adding: [],
    skipped: [],
    errors: [],
    doneByte: 0,
    done: [],
})

// keep track of speed
let bytesSentTimestamp = Date.now()
let bytesSent = 0
setInterval(() => {
    const now = Date.now()
    const passed = (now - bytesSentTimestamp) / 1000
    if (passed < 3 && uploadState.speed) return
    uploadState.speed = bytesSent / passed
    bytesSent = 0 // reset counter
    bytesSentTimestamp = now

    // keep track of ETA
    const qBytes = _.sumBy(uploadState.qs, q => _.sumBy(q.entries, x => x.file.size))
    const left = (qBytes  - uploadState.partial)
    uploadState.eta = uploadState.speed && Math.round(left / uploadState.speed)
}, 5_000)

window.onbeforeunload = ev => {
    if (!uploadState.qs.length) return
    ev.preventDefault()
    return ev.returnValue = t("Uploading") // modern browsers ignore this message
}

let reloadOnClose = false
let uploadDialogIsOpen = false
let everPaused = false

function resetCounters() {
    Object.assign(uploadState, {
        errors: [],
        done: [],
        doneByte: 0,
        skipped: [],
    })
}

export function showUpload() {
    if (!uploadState.qs.length)
        resetCounters()
    uploadDialogIsOpen = true
    const { close } = newDialog({
        dialogProps: { id: 'upload-dialog', style: { minHeight: '6em', minWidth: 'min(20em, 100vw - 1em)' } },
        title: t`Upload`,
        icon: () => hIcon('upload'),
        Content,
        onClose() {
            uploadDialogIsOpen = false
            if (!reloadOnClose) return
            reloadOnClose = false
            reloadList()
        }
    })

    function clear() {
        uploadState.adding.splice(0,Infinity)
    }

    function Content(){
        const { qs, paused, eta, speed, adding } = useSnapshot(uploadState) as Readonly<typeof uploadState>
        const { props, uploadOnExisting } = useSnapState()
        const etaStr = useMemo(() => !eta ? '' : formatTime(eta*1000, 0, 2), [eta])
        const inQ = _.sumBy(qs, q => q.entries.length) - (uploadState.uploading ? 1 : 0)
        const queueStr = inQ && t('in_queue', { n: inQ }, "{n} in queue")
        const size = formatBytes(adding.reduce((a, x) => a + x.file.size, 0))
        const isMobile = useIsMobile()

        return h(FlexV, { gap: '.5em', props: acceptDropFiles((files, to) => uploadState.adding.push(...files.map(f => ({ file: ref(f), to })))) },
            h(FlexV, { className: 'upload-toolbar' },
                !props?.can_upload ? t('no_upload_here', "No upload permission for the current folder")
                    : h(FlexV, {},
                        h(Flex, { center: true, flexWrap: 'wrap', alignItems: 'stretch' },
                            h('button', {
                                className: 'upload-files',
                                onClick: () => pickFiles({ accept: normalizeAccept(props?.accept) })
                            }, t`Pick files`),
                            !isMobile && h('button', {
                                className: 'upload-folder',
                                onClick: () => pickFiles({ folder: true })
                            }, t`Pick folder`),
                            h('button', { className: 'create-folder', onClick: createFolder }, t`Create folder`),
                            h(Select<typeof uploadOnExisting>, {
                                style: { width: 'unset' },
                                'aria-label': t`Overwrite policy`,
                                value: uploadOnExisting || '',
                                onChange: v => state.uploadOnExisting = v,
                                options: onlyTruthy([
                                    { value: 'skip', label: t`Skip existing files` },
                                    renameEnabled && { value: 'rename', label: t`Rename to avoid overwriting` },
                                    props?.can_overwrite && { value: 'overwrite', label: t`Overwrite existing files` },
                                ])
                            }),
                        ),
                        !isMobile && h(Flex, { gap: 4 }, hIcon('info'), t('upload_dd_hint', "You can upload files doing drag&drop on the files list")),
                        adding.length > 0 && h(Flex, { center: true, flexWrap: 'wrap' },
                            h('button', {
                                className: 'upload-send',
                                onClick() {
                                    void enqueue(uploadState.adding)
                                    clear()
                                }
                            }, t('send_files', { n: adding.length, size }, "Send {n,plural,one{# file} other{# files}}, {size}")),
                            h('button', { onClick: clear }, t`Clear`),
                        )
                    ),
            ),
            h(FilesList, {
                entries: uploadState.adding,
                actions: {
                    cancel: rec => _.remove(uploadState.adding, rec),
                    async comment(rec){
                        if (!props?.can_comment) return
                        const s = await inputComment(basename(rec.file.name), rec.comment)
                        if (s === undefined) return
                        rec.comment = s || undefined
                    },
                    async edit(rec) {
                        const value = rec.file.name
                        const s = await promptDialog(t('upload_name', "Upload with new name"), {
                            value,
                            onField: el => el.setSelectionRange(0, value.lastIndexOf('.')),
                        })
                        if (!s) return
                        rec.name = s
                    },
                },
            }),
            h(UploadStatus, { margin: '.5em 0' }),
            qs.length > 0 && h('div', {},
                h(Flex, { center: true, borderTop: '1px dashed', padding: '.5em' },
                    [queueStr, etaStr, speed && formatSpeed(speed)].filter(Boolean).join(', '),
                    inQ > 0 && iconBtn('delete', ()=>  {
                        uploadState.qs = []
                        abortCurrentUpload()
                    }),
                    inQ > 0 && iconBtn(paused ? 'play' : 'pause', () => {
                        uploadState.paused = !uploadState.paused
                        if (!everPaused) {
                            everPaused = true
                            alertDialog("Pause applies to the queue, but current file will still be uploaded")
                        }
                    }),
                ),
                qs.map((q,idx) =>
                    h('div', { key: q.to },
                        h(Link, { to: q.to, onClick: close }, t`Destination`, ' ', decodeURI(q.to)),
                        h(FilesList, {
                            entries: uploadState.qs[idx].entries,
                            actions: {
                                cancel: f => {
                                    if (f === uploadState.uploading)
                                        return abortCurrentUpload()
                                    const q = uploadState.qs[idx]
                                    _.pull(q.entries, f)
                                    if (!q.entries.length)
                                        uploadState.qs.splice(idx,1)
                                }
                            }
                        }),
                    ))
            )
        )

        function pickFiles(options: Parameters<typeof selectFiles>[1]) {
            selectFiles(list => {
                uploadState.adding.push( ...Array.from(list || []).filter(simulateBrowserAccept).map(f => ({ file: ref(f) })) )
            }, options)
        }
    }

}

function path(f: File) {
    return (f.webkitRelativePath || f.name).replaceAll('//','/')
}

function FilesList({ entries, actions }: { entries: ToUpload[], actions: { [icon:string]: null | ((rec :ToUpload) => any) } }) {
    const { uploading, progress }  = useSnapshot(uploadState)
    const snapEntries = useSnapshot(entries)
    const [all, setAll] = useState(false)
    useEffect(() => setAll(false), [entries.length])
    const MAX = all ? Infinity : _.round(_.clamp(100 * cpuSpeedIndex, 10, 100))
    const rest = Math.max(0, snapEntries.length - MAX)
    return !snapEntries.length ? null : h('table', { className: 'upload-list', width: '100%' },
        h('tbody', {},
            snapEntries.slice(0, MAX).map((e, i) => {
                const working = e === uploading
                return h(Fragment, { key: i },
                    h('tr', {},
                        h('td', { className: 'nowrap '}, ..._.map(actions, (cb, icon) =>
                            cb && iconBtn(icon, () => cb(entries[i]), { className: `action-${icon}` })) ),
                        h('td', {}, formatBytes(e.file.size)),
                        h('td', {},
                            h('span', { className: working ? 'ani-working' : undefined }, e.name || path(entries[i].file)),
                            working && h('span', { className: 'upload-progress' }, formatPerc(progress)),
                            working && h('progress', { className: 'upload-progress-bar', value: progress, max: 1 }),
                        ),
                    ),
                    e.comment && h('tr', {}, h('td', { colSpan: 3 }, h('div', { className: 'entry-comment' }, e.comment)) )
                )
            }),
            rest > 0 && h('tr', {}, h('td', { colSpan: 99 }, h('a', { href: '#', onClick: () => setAll(true) }, t('more_items', { n: rest }, "{n} more item(s)"))))
        )
    )
}

function formatTime(time: number, decimals=0, length=Infinity) {
    time /= 1000
    const ret = [(time % 1).toFixed(decimals).slice(1)]
    for (const [c,mod,pad] of [['s', 60, 2], ['m', 60, 2], ['h', 24], ['d', 36], ['y', 1 ]] as [string,number,number|undefined][]) {
        ret.push( _.padStart(String(time % mod | 0), pad || 0,'0') + c )
        time /= mod
        if (time < 1) break
    }
    return ret.slice(-length).reverse().join('')
}

/// Manage upload queue

subscribe(uploadState, () => {
    const [cur] = uploadState.qs
    if (!cur?.entries.length) {
        notificationChannel = '' // renew channel at each queue for improved security
        notificationSource?.close()
        return
    }
    if (cur?.entries.length && !uploadState.uploading && !uploadState.paused)
        void startUpload(cur.entries[0], cur.to)
})

export async function enqueue(entries: ToUpload[], to=location.pathname) {
    if (_.remove(entries, x => !simulateBrowserAccept(x.file)).length)
        await alertDialog(t('upload_file_rejected', "Some files were not accepted"), 'warning')

    entries = _.uniqBy(entries, x => path(x.file))
    if (!entries.length) return
    const q = _.find(uploadState.qs, { to })
    if (!q)
        return uploadState.qs.push({ to, entries: entries.map(ref) })
    const missing = _.differenceBy(entries, q.entries, x => path(x.file))
    q.entries.push(...missing.map(ref))
}

function simulateBrowserAccept(f: File) {
    const { props } = state
    if (!props?.accept) return true
    return normalizeAccept(props?.accept)!.split(/ *[|,] */).some(pattern =>
        pattern.startsWith('.') ? f.name.endsWith(pattern)
            : f.type.match(pattern.replace('.','\\.').replace('*', '.*')) // '.' for .ext and '*' for 'image/*'
    )
}

function normalizeAccept(accept?: string) {
    return accept?.replace(/\|/g, ',').replace(/ +/g, '')
}

let req: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let notificationSource: EventSource | undefined
let closeLast: undefined | (() => void)

async function startUpload(toUpload: ToUpload, to: string, resume=0) {
    let resuming = false
    overrideStatus = 0
    uploadState.uploading = toUpload
    await subscribeNotifications()
    const splitSize = getHFS().splitUploads
    const fullSize = toUpload.file.size
    let offset = resume
    do { // at least one iteration, even for empty files
        req = new XMLHttpRequest()
        const finished = pendingPromise()
        req.onloadend = () => {
            finished.resolve()
            if (req?.readyState !== 4) return
            const status = overrideStatus || req.status
            if (!partial) // if the upload ends here, the offer for resuming must stop
                closeLast?.()
            if (resuming) { // resuming requested
                resuming = false // this behavior is only for once, for cancellation of the upload that is in the background while resume is confirmed
                stopLooping()
                return
            }
            if (!status || status === HTTP_CONFLICT) // 0 = user-aborted, HTTP_CONFLICT = skipped because existing
                uploadState.skipped.push(toUpload)
            else if (status >= 400)
                error(status)
            else {
                if (splitSize) {
                    offset += splitSize
                    if (offset < fullSize) return // continue looping
                }
                done()
            }
            next()
        }
        req.onerror = () => {
            error(0)
            finished.resolve()
            stopLooping()
        }
        let lastProgress = 0
        req.upload.onprogress = (e:any) => {
            uploadState.partial = e.loaded + offset
            uploadState.progress = uploadState.partial / fullSize
            bytesSent += e.loaded - lastProgress
            lastProgress = e.loaded
        }
        let uploadPath = path(toUpload.file)
        if (toUpload.name)
            uploadPath = prefix('', dirname(uploadPath), '/') + toUpload.name
        const partial = splitSize && offset + splitSize < fullSize
        req.open('PUT', to + pathEncode(uploadPath) + buildUrlQueryString({
            notificationChannel,
            ...partial && { partial: 'y' },
            ...offset && { resume: String(offset) },
            ...toUpload.comment && { comment: toUpload.comment },
            ...with_(state.uploadOnExisting, x => x !== 'rename' && { existing: x }), // rename is the default
        }), true)
        req.send(toUpload.file.slice(offset, splitSize ? offset + splitSize : undefined))
        await finished
    } while (offset < fullSize)

    function stopLooping() { offset = fullSize }

    async function subscribeNotifications() {
        if (notificationChannel) return
        notificationChannel = 'upload-' + randomId()
        notificationSource = await getNotifications(notificationChannel, async (name, data) => {
            const {uploading} = uploadState
            if (!uploading) return
            if (name === 'upload.resumable') {
                const size = data?.[path(uploading.file)] //TODO use toUpload?
                if (!size || size > toUpload.file.size) return
                const {expires} = data
                const timeout = typeof expires !== 'number' ? 0
                    : (Number(new Date(expires)) - Date.now()) / 1000
                closeLast?.()
                const cancelSub = subscribeKey(uploadState, 'partial', v =>
                    v >= size && closeLast?.() )  // dismiss dialog as soon as we pass the threshold
                const msg = t('confirm_resume', "Resume upload?") + ` (${formatPerc(size/toUpload.file.size)} = ${formatBytes(size)})`
                const dialog = confirmDialog(msg, { timeout })
                closeLast = dialog.close
                const confirmed = await dialog
                cancelSub()
                if (!confirmed) return
                if (uploading !== uploadState.uploading) return // too late
                resuming = true
                abortCurrentUpload()
                return startUpload(toUpload, to, size)
            }
            if (name === 'upload.status') {
                overrideStatus = data?.[path(uploading.file)]
                if (overrideStatus >= 400)
                    abortCurrentUpload()
                return
            }
        })
    }

    function error(status: number) {
        const ERRORS = {
            [HTTP_PAYLOAD_TOO_LARGE]: t`file too large`,
            [HTTP_CONFLICT]: t('upload_conflict', "already exists"),
        }
        const specifier = (ERRORS as any)[status] || HTTP_MESSAGES[status]
        toUpload.error = specifier
        if (uploadState.errors.push(toUpload)) return
        const msg = t('failed_upload', toUpload, "Couldn't upload {name}") + prefix(': ', specifier)
        closeLast?.()
        closeLast = alertDialog(msg, 'error').close
    }

    function done() {
        uploadState.done.push(toUpload)
        uploadState.doneByte += toUpload!.file.size
        reloadOnClose = true
    }

    function next() {
        stopLooping()
        uploadState.uploading = undefined
        uploadState.partial = 0
        const { qs } = uploadState
        if (!qs.length) return
        qs[0].entries.shift()
        if (!qs[0].entries.length)
            qs.shift()
        if (qs.length) return
        setTimeout(reloadList, 500) // workaround: reloading too quickly can meet the new file still with its temp name
        reloadOnClose = false
        if (uploadDialogIsOpen) return
        // freeze and reset
        const snap = snapshot(uploadState)
        resetCounters()
        const msg = h('div', {}, t(['upload_concluded', "Upload terminated"], "Upload concluded:"),
            h(UploadStatus, { snapshot: snap, display: 'flex', flexDirection: 'column' }) )
        if (snap.errors.length || snap.skipped.length)
            alertDialog(msg, 'warning')
        else
            toast(msg, 'success')
    }
}

function UploadStatus({ snapshot, ...props }: { snapshot?: INTERNAL_Snapshot<typeof uploadState> } & CSSProperties) {
    const current = useSnapshot(uploadState)
    const { done, doneByte, errors, skipped } = snapshot || current
    const msgDone = done.length > 0 && t('upload_finished', { n: done.length, size: formatBytes(doneByte) }, "{n} finished ({size})")
    const msgSkipped = skipped.length > 0 && t('upload_skipped', { n: skipped.length }, "{n} skipped")
    const msgErrors = errors.length > 0 && t('upload_errors', { n: errors.length }, "{n} failed")
    const s = [msgDone, msgSkipped, msgErrors].filter(Boolean).join(' – ')
    if (!s) return null
    return h('div', { style: { ...props } },
        s, ' – ', h(Btn, { label: t`Show details`, asText: true, onClick: showDetails }) )

    function showDetails() {
        if (!uploadDialogIsOpen)
            closeDialog() // don't nest dialogs unnecessarily (apply only to the dialog outside upload-dialog)
        alertDialog(h('div', {},
            ([
                [msgDone, done],
                [msgSkipped, skipped],
                [msgErrors, errors]
            ] as const).map(([msg, list], i) =>
                msg && h('div', { key: i }, msg, h('ul', {},
                    list.map((x, i) => h('li', { key: i }, x.name || x.file.name, prefix(' (', x.error, ')'))) )))
        ))
    }
}

function abortCurrentUpload() {
    req?.abort()
}

export function acceptDropFiles(cb: false | undefined | ((files:File[], to: string) => void)) {
    return {
        onDragOver(ev: DragEvent) {
            ev.preventDefault()
            ev.dataTransfer!.dropEffect = cb && ev.dataTransfer.types.includes('Files') ? 'copy' : 'none'
        },
        onDrop(ev: DragEvent) {
            ev.preventDefault()
            if (!cb) return
            for (const it of ev.dataTransfer.items) {
                const entry = it.webkitGetAsEntry()
                if (entry)
                    (function recur(entry: FileSystemEntry, to = '') {
                        if (entry.isFile)
                            (entry as FileSystemFileEntry).file(x => cb([x], x.webkitRelativePath ? '' : to)) // ff130 fills webkitRelativePath when dropping a folder, while chrome128 doesn't and we pass 'to' to preserve the structure
                        else (entry as FileSystemDirectoryEntry).createReader?.().readEntries(entries => {
                            const newTo = to + entry.name + '/'
                            for (const e of entries)
                                recur(e, newTo)
                        })
                    })(entry)
            }
        },
    }
}

export async function createFolder() {
    const name = await promptDialog(t`Enter folder name`)
    if (!name) return
    const uri = location.pathname
    try {
        await apiCall('create_folder', { uri, name }, { modal: working })
        reloadList()
        await alertDialog(h(() =>
            h(FlexV, {},
                h('div', {}, t`Successfully created`),
                h(LinkClosingDialog, { to: uri + encodeURIComponent(name) + '/' }, t('enter_folder', "Enter the folder")),
            )))
    }
    catch(e: any) {
        await alertDialog(e.code === HTTP_CONFLICT ? t('folder_exists', "Folder with same name already exists") : e)
    }
}

export function inputComment(filename: string, value?: string) {
    return promptDialog(t('enter_comment', { name: filename }, "Comment for {name}"), { value, type: 'textarea' })
}
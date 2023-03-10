// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, useMemo, useState } from 'react'
import { Flex, FlexV } from './components'
import { closeDialog, DialogCloser, formatBytes, formatPerc, hIcon, newDialog, prefix, selectFiles } from './misc'
import _ from 'lodash'
import { proxy, ref, subscribe, useSnapshot } from 'valtio'
import { alertDialog, confirmDialog, promptDialog } from './dialog'
import { reloadList } from './useFetchList'
import { apiCall, getNotification } from './api'
import { useSnapState } from './state'
import { Link } from 'react-router-dom'
import { t } from './i18n'

export const uploadState = proxy<{
    done: number
    doneByte: number
    errors: number
    qs: { to: string, files: File[] }[]
    paused: boolean
    uploading?: File
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
    errors: 0,
    doneByte: 0,
    done: 0,
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
}, 1_000)

// keep track of ETA
setInterval(() => {
    const qBytes = _.sumBy(uploadState.qs, q => _.sumBy(q.files, f => f.size))
    const left = (qBytes  - uploadState.partial)
    uploadState.eta = uploadState.speed && Math.round(left / uploadState.speed)
}, 1000)

let reloadOnClose = false
let uploadDialogIsOpen = false

function resetCounters() {
    Object.assign(uploadState, {
        errors: 0,
        done: 0,
        doneByte: 0,
    })
}

export function showUpload() {
    if (!uploadState.qs.length)
        resetCounters()
    uploadDialogIsOpen = true
    const close = newDialog({
        dialogProps: { style: { minHeight: '6em', minWidth: 'min(20em, 100vw - 1em)' } },
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

    function Content(){
        const [files, setFiles] = useState([] as File[])
        const { qs, paused, eta } = useSnapshot(uploadState)
        const { can_upload } = useSnapState()
        const etaStr = useMemo(() => !eta ? '' : formatTime(eta*1000, 0, 2), [eta])
        const size = formatBytes(files.reduce((a, f) => a + f.size, 0))

        return h(FlexV, { props: acceptDropFiles(x => setFiles([ ...files, ...x ])) },
            h(FlexV, { position: 'sticky', top: -4, background: 'var(--bg)' },
                !can_upload ? t('no_upload_here', "No upload permission for the current folder")
                    : h(Flex, { justifyContent: 'center', flexWrap: 'wrap', marginTop: '1em' },
                        h('button', { onClick: () => pickFiles() }, t`Pick files`),
                        h('button', { onClick: () => pickFiles(true) }, t`Pick folder`),
                        files.length > 0 &&  h('button', {
                            onClick() {
                                enqueue(files)
                                setFiles([])
                            }
                        }, t('send_files', { n: files.length, size }, "Send {n,plural,one{# file} other{# files}}, {size}")),
                        files.length > 1 && h('button', { onClick() { setFiles([]) } }, t`Clear`),
                        h('button', { onClick: createFolder }, t`Create folder`),
                    ),
            ),
            h(FilesList, {
                files,
                remove(f) {
                    setFiles(files.filter(x => x !== f))
                }
            }),
            h(UploadStatus),
            qs.length > 0 && h('div', {},
                h(Flex, { alignItems: 'center', justifyContent: 'center', borderTop: '1px dashed', padding: '.5em' },
                    `${_.sumBy(qs, q => q.files.length)} in queue${prefix(', ', etaStr)}`,
                    iconBtn('trash', ()=>  {
                        uploadState.qs = []
                        abortCurrentUpload()
                    }),
                    iconBtn(paused ? '▶' : '⏸', () => {
                        uploadState.paused = !uploadState.paused
                    }),
                ),
                qs.map((q,idx) =>
                    h('div', { key: q.to },
                        h(Link, { to: q.to, onClick: close }, "Destination ", decodeURI(q.to)),
                        h(FilesList, {
                            files: Array.from(q.files),
                            remove(f) {
                                if (f === uploadState.uploading)
                                    return abortCurrentUpload()
                                const q = uploadState.qs[idx]
                                _.pull(q.files, f)
                                if (!q.files.length)
                                    uploadState.qs.splice(idx,1)
                            }
                        }),
                    ))
            )
        )

        function pickFiles(folder=false) {
            selectFiles(list => setFiles([ ...files, ...list ||[] ] ), { folder })
        }
    }

}

function path(f: File, pre='') {
    return (prefix('', pre, '/') + (f.webkitRelativePath || f.name)).replaceAll('//','/')
}

function FilesList({ files, remove }: { files: File[], remove: (f:File) => any }) {
    const { uploading, progress }  = useSnapshot(uploadState)
    return !files.length ? null : h('table', { className: 'upload-list', width: '100%' },
        h('tbody', {},
            files.map((f,i) => {
                const working = f === uploading
                return h('tr', { key: i },
                    h('td', {}, iconBtn('trash', () => remove(f))),
                    h('td', {}, formatBytes(f.size)),
                    h('td', { className: working ? 'ani-working' : undefined },
                        path(f),
                        working && h('span', { className: 'upload-progress' }, formatPerc(progress))
                    ),
                )
            })
        )
    )
}

function iconBtn(icon: string, onClick: () => any, { small=true, style={}, ...props }={}) {
    return h('button', {
            onClick,
            ...props,
            ...small && {
                style: { padding: '.1em', width: 35, height: 30, ...style }
            }
        },
        icon.length > 1 ? hIcon(icon) : icon
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
    if (!cur?.files.length) {
        notificationChannel = '' // renew channel at each queue for improved security
        notificationSource.close()
        return
    }
    if (cur?.files.length && !uploadState.uploading && !uploadState.paused)
        startUpload(cur.files[0], cur.to).then()
})

export function enqueue(files: File[]) {
    const to = location.pathname
    const ready = _.find(uploadState.qs, { to })
    if (!ready)
        return uploadState.qs.push({ to, files: files.map(ref) })
    _.remove(ready.files, f => { // avoid duplicates
        const match = path(f)
        return Boolean(_.find(files, x => match === path(x)))
    })
    ready.files.push(...files.map(ref))
}

let req: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let notificationSource: EventSource
let closeLast: DialogCloser | undefined

async function startUpload(f: File, to: string, resume=0) {
    let resuming = false
    overrideStatus = 0
    uploadState.uploading = f
    await subscribeNotifications()
    req = new XMLHttpRequest()
    req.onloadend = () => {
        if (req?.readyState !== 4) return
        const status = overrideStatus || req.status
        closeLast?.()
        if (status) // 0 = user-aborted
            if (status >= 400)
                error(status)
            else
                done()
        if (!resuming)
            next()
    }
    req.onerror = () => error(0)
    let lastProgress = 0
    req.upload.onprogress = (e:any) => {
        uploadState.partial = e.loaded + resume
        uploadState.progress = uploadState.partial / (e.total + resume)
        bytesSent += e.loaded - lastProgress
        lastProgress = e.loaded
    }
    req.open('POST', to + '?' + new URLSearchParams({ notificationChannel, resume: String(resume) }), true)
    const form = new FormData()
    form.append('file', f.slice(resume), path(f))
    req.send(form)

    async function subscribeNotifications() {
        if (!notificationChannel) {
            notificationChannel = 'upload-' + Math.random().toString(36).slice(2)
            notificationSource = await getNotification(notificationChannel, async (name, data) => {
                const {uploading} = uploadState
                if (!uploading) return
                if (name === 'upload.resumable') {
                    const size = data?.[path(uploading)]
                    if (!size || size > f.size) return
                    const {expires} = data
                    const timeout = typeof expires !== 'number' ? 0
                        : (Number(new Date(expires)) - Date.now()) / 1000
                    closeLast?.()
                    const msg = t('confirm_resume', "Resume upload?") + ` (${formatPerc(size/f.size)} = ${formatBytes(size)})`
                    if (!await confirmDialog(msg, { timeout, getClose: x => closeLast=x })) return
                    if (uploading !== uploadState.uploading) return // too late
                    resuming = true
                    abortCurrentUpload()
                    return startUpload(f, to, size)
                }
                if (name === 'upload.status') {
                    overrideStatus = data?.[path(uploading)]
                    if (overrideStatus >= 400)
                        abortCurrentUpload()
                    return
                }
            })
        }
    }

    function error(status: number) {
        if (uploadState.errors++) return
        const ERRORS = {
            413: t`file too large`,
        }
        const specifier = (ERRORS as any)[status]
        const msg = t('failed_upload', f, "Couldn't upload {name}") + prefix(': ', specifier)
        closeLast?.()
        return alertDialog(msg, 'error', { getClose: x => closeLast=x })
    }

    function done() {
        uploadState.done++
        uploadState.doneByte += f!.size
        reloadOnClose = true
    }

    function next() {
        uploadState.uploading = undefined
        uploadState.partial = 0
        const { qs } = uploadState
        if (!qs.length) return
        qs[0].files.shift()
        if (!qs[0].files.length)
            qs.shift()
        if (qs.length) return
        setTimeout(reloadList, 500) // workaround: reloading too quickly can meet the new file still with its temp name
        reloadOnClose = false
        if (!uploadDialogIsOpen)
            alertDialog(h('div', {}, t`Upload terminated`, h('div', {}, h(UploadStatus))), 'info')
                .finally(resetCounters)
    }
}

function UploadStatus() {
    const { done, doneByte, errors } = useSnapshot(uploadState)
    return h(Fragment, {},
        [
            done && t('upload_finished', { n: done, size: formatBytes(doneByte) }, "{n} finished ({size})"),
            errors && t('upload_errors', { n: errors }, "{n} failed")
        ].filter(Boolean).join(' – ')
    )
}

function abortCurrentUpload() {
    req?.abort()
}

export function acceptDropFiles(cb: false | undefined | ((files:File[]) => void)) {
    return {
        onDragOver(ev: DragEvent) {
            ev.preventDefault()
            ev.dataTransfer!.dropEffect = cb ? 'copy' : 'none'
        },
        onDrop(ev: DragEvent) {
            ev.preventDefault()
            cb && cb(Array.from(ev.dataTransfer!.files))
        },
    }
}

async function createFolder() {
    const name = await promptDialog(t`Enter folder name`)
    if (!name) return
    const path = location.pathname
    try {
        await apiCall('create_folder', { path, name })
        reloadList()
        return alertDialog(h(() =>
            h(FlexV, {},
                h('div', {}, t`Successfully created`),
                h(Link, { to: path + name + '/', onClick() {
                    closeDialog()
                    closeDialog()
                } }, t('enter_folder', "Enter the folder")),
            )))
    }
    catch(e: any) {
        await alertDialog(e.code === 409 ? t('folder_exists', "Folder with same name already exists") : e)
    }
}
import {
    buildUrlQueryString, dirname, formatBytes, formatPerc, getHFS,
    HTTP_CONFLICT, HTTP_MESSAGES, HTTP_PAYLOAD_TOO_LARGE,
    pathEncode, pendingPromise, prefix, randomId, with_
} from '@hfs/shared'
import { state } from './state'
import { getNotifications } from '@hfs/shared/api'
import { subscribeKey } from 'valtio/utils'
import { t } from './i18n'
import { alertDialog, confirmDialog, toast } from './dialog'
import { reloadList } from './useFetchList'
import { proxy, ref, snapshot, subscribe } from 'valtio'
import { createElement as h } from 'react'
import _ from 'lodash'
import { UploadStatus } from './upload'

export interface ToUpload { file: File, comment?: string, name?: string, to?: string, error?: string }
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
    uploadDialogIsOpen: boolean
}>({
    uploadDialogIsOpen: false,
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

window.onbeforeunload = ev => {
    if (!uploadState.qs.length) return
    ev.preventDefault()
    return ev.returnValue = t("Uploading") // modern browsers ignore this message
}

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

let req: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let notificationSource: EventSource | undefined
let closeLast: undefined | (() => void)

let reloadOnClose = false
export function resetReloadOnClose() {
    if (!reloadOnClose) return
    reloadOnClose = false
    return true
}

export async function startUpload(toUpload: ToUpload, to: string, resume=0) {
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
        let uploadPath = getFilePath(toUpload.file)
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
                const size = data?.[getFilePath(uploading.file)] //TODO use toUpload?
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
                overrideStatus = data?.[getFilePath(uploading.file)]
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
        if (uploadState.uploadDialogIsOpen) return
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

export function abortCurrentUpload() {
    req?.abort()
}
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

export async function enqueueUpload(entries: ToUpload[], to=location.pathname) {
    if (_.remove(entries, x => !simulateBrowserAccept(x.file)).length)
        await alertDialog(t('upload_file_rejected', "Some files were not accepted"), 'warning')

    entries = _.uniqBy(entries, x => getFilePath(x.file))
    if (!entries.length) return
    const q = _.find(uploadState.qs, { to })
    if (!q)
        return uploadState.qs.push({ to, entries: entries.map(ref) })
    const missing = _.differenceBy(entries, q.entries, x => getFilePath(x.file))
    q.entries.push(...missing.map(ref))
}

export function simulateBrowserAccept(f: File) {
    const { props } = state
    if (!props?.accept) return true
    return normalizeAccept(props?.accept)!.split(/ *[|,] */).some(pattern =>
        pattern.startsWith('.') ? f.name.endsWith(pattern)
            : f.type.match(pattern.replace('.','\\.').replace('*', '.*')) // '.' for .ext and '*' for 'image/*'
    )
}

export function normalizeAccept(accept?: string) {
    return accept?.replace(/\|/g, ',').replace(/ +/g, '')
}

export function getFilePath(f: File) {
    return (f.webkitRelativePath || f.name).replaceAll('//','/')
}

export function resetCounters() {
    Object.assign(uploadState, {
        errors: [],
        done: [],
        doneByte: 0,
        skipped: [],
    })
}

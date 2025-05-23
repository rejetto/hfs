import {
    HTTP_CONFLICT, HTTP_MESSAGES, HTTP_PAYLOAD_TOO_LARGE, HTTP_RANGE_NOT_SATISFIABLE,
    UPLOAD_RESUMABLE, UPLOAD_REQUEST_STATUS, UPLOAD_RESUMABLE_HASH,
    buildUrlQueryString, dirname, getHFS, pathEncode, pendingPromise, prefix, randomId, tryJson, with_, wait, waitFor,
} from '@hfs/shared'
import { state } from './state'
import { getNotifications } from '@hfs/shared/api'
import { alertDialog, toast } from './dialog'
import { reloadList } from './useFetchList'
import { proxy, ref, snapshot, subscribe } from 'valtio'
import { createElement as h } from 'react'
import _ from 'lodash'
import { UploadStatus } from './upload'
import { hfsEvent, onHfsEvent } from './misc'
import i18n from './i18n'
const { t } = i18n

export interface ToUpload { file: File, comment?: string, name?: string, to?: string, error?: string }
export const uploadState = proxy<{
    done: (ToUpload & { response?: any })[] // res will contain the response from the server,
    doneByte: number
    errors: ToUpload[]
    skipped: ToUpload[]
    adding: ToUpload[]
    qs: { to: string, entries: ToUpload[] }[]
    paused: boolean
    uploading?: ToUpload
    hashing?: number
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

let stuckSince = Infinity
// keep track of speed
let bytesSentTimestamp = Date.now()
let bytesSent = 0
setInterval(() => {
    const now = Date.now()
    const passed = (now - bytesSentTimestamp) / 1000
    uploadState.speed = bytesSent / passed
    if (currentReq && now - stuckSince >= 10_000) // this will normally cause the upload to be retried after long time of no progress
        currentReq.abort()
    bytesSent = 0 // reset counter
    bytesSentTimestamp = now

    // keep track of ETA
    const qBytes = _.sumBy(uploadState.qs, q => _.sumBy(q.entries, x => x.file.size))
    const left = (qBytes  - uploadState.partial)
    uploadState.eta = uploadState.speed && Math.round(left / uploadState.speed)
}, 2_000)

let currentReq: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let userAborted = false
let notificationSource: EventSource | undefined
let closeLastDialog: undefined | (() => void)
let currentNotificationHandler: (name: string, data: any) => void
const { OPEN } = EventSource

let reloadOnClose = false
export function resetReloadOnClose() {
    if (!reloadOnClose) return
    reloadOnClose = false
    return true
}

export async function startUpload(toUpload: ToUpload, to: string, startingResume=0) {
    console.debug('start upload', getFilePath(toUpload.file), startingResume)
    let resuming = false
    let preserveTempFile = undefined
    uploadState.uploading = toUpload
    uploadState.progress = 0
    userAborted = false
    await subscribeNotifications() // subscribe before the request
    const waitSecondChunk = pendingPromise() // to avoid race condition in case the notification arrives after the first chunk is finished
    const splitSize = getHFS().splitUploads
    const fullSize = toUpload.file.size
    let offset = startingResume
    let splitResume = startingResume // keep track of "split" advancements
    let lastWrittenReceived = 0
    let stopLooping = false
    do { // at least one iteration, even for empty files
        offset = Math.max(splitResume, lastWrittenReceived)
        const req = currentReq = new XMLHttpRequest()
        const requestIsOver = pendingPromise()
        overrideStatus = 0
        stuckSince = Date.now()
        req.onloadend = async () => {
            try {
                currentReq = undefined
                const status = overrideStatus || req.status
                if (status === HTTP_RANGE_NOT_SATISFIABLE) {
                    lastWrittenReceived = 0
                    return
                }
                if (resuming) { // resuming requested
                    resuming = false // this behavior is only for once, for cancellation of the upload that is in the background while resume is confirmed
                    stopLooping = true
                    return
                }
                if (userAborted || status === HTTP_CONFLICT) // HTTP_CONFLICT = skipped because existing
                    uploadState.skipped.push(toUpload)
                else if (status >= 400)
                    error(status)
                else if (!status) // request failed at a network level, so try again same file (return), but not too often (wait)
                    return await wait(2000) // wait before resolving `finished`
                else {
                    if (splitSize) {
                        splitResume += splitSize
                        if (splitResume < fullSize) return // go on with the next chunk
                    }
                    stopLooping = true
                    waitSecondChunk.resolve() // we finished, no need to wait
                    uploadState.done.push({ ...toUpload, response: tryJson(req.responseText) })
                    uploadState.doneByte += toUpload!.file.size
                    reloadOnClose = true
                }
                requestIsOver.then(workNextFile)
            }
            finally {
                requestIsOver.resolve()
            }
        }
        let lastProgress = 0
        req.upload.onprogress = (e:any) => {
            uploadState.partial = e.loaded + offset
            uploadState.progress = uploadState.partial / fullSize
            bytesSent += e.loaded - lastProgress
            if (e.loaded > lastProgress)
                stuckSince = Date.now()
            lastProgress = e.loaded
        }
        let uploadPath = getFilePath(toUpload.file)
        if (toUpload.name)
            uploadPath = prefix('', dirname(uploadPath), '/') + toUpload.name
        const partial = splitSize && offset + splitSize < fullSize
        req.open('PUT', to + pathEncode(uploadPath) + buildUrlQueryString({
            notificationChannel,
            giveBack: toUpload.file.lastModified,
            ...partial && { partial: fullSize - offset }, // how much space we need
            ...offset && { resume: offset, preserveTempFile },
            ...toUpload.comment && { comment: toUpload.comment },
            ...with_(state.uploadOnExisting, x => x !== 'rename' && { existing: x }), // rename is the default
        }), true)
        req.send(toUpload.file.slice(offset, splitSize ? offset + splitSize : undefined))
        await requestIsOver
        if (!startingResume && notificationSource?.readyState === OPEN) // wait only if notifications are currently available
            await waitSecondChunk
    } while (!stopLooping && offset < fullSize)

    async function subscribeNotifications() {
        // we want to getNotifications once, as establishing a connection is slow in the case of many small files;
        // since our handler refers to closures and needs updates, we use indirection via currentNotificationHandler
        currentNotificationHandler = notificationHandler
        if (notificationChannel) // already subscribed
            return waitFor(() => userAborted || notificationSource?.readyState === OPEN) // ensure the system is still alive
        notificationChannel = 'upload-' + randomId()
        notificationSource = await getNotifications(notificationChannel, async (name, data) => currentNotificationHandler(name, data))
    }

    async function notificationHandler(name: string, data: any) {
        const {uploading} = uploadState
        if (!uploading) return
        const PREFIX = 'resume hash/'
        if (name === UPLOAD_RESUMABLE_HASH)
            return hfsEvent(PREFIX + data.path, data.hash)
        if (name === UPLOAD_RESUMABLE) {
            waitSecondChunk.resolve()
            const path = getFilePath(uploading.file)
            if (path !== data.path) return // is it about current file?
            if (data.written)
                return lastWrittenReceived = data.written
            const {size} = data //TODO use toUpload?
            if (!size)
                return preserveTempFile = undefined
            preserveTempFile = true // this is affecting only split-uploads, because is undefined on first chunk (or no chunking)
            if (size > toUpload.file.size) return
            if (data.giveBack) {
                // lastModified doesn't necessarily mean the file has changed, but it seems ok for the time being
                if (data.giveBack !== String(toUpload.file.lastModified)) // query params are always string
                    return console.debug('upload timestamp changed')
                console.debug('upload unchanged')
            }
            else { // timestamp may miss if the file is left by old version, or HFS was killed
                const hashFromServer = new Promise<any>(res => onHfsEvent(PREFIX + path, res))
                const hashed = await calcHash(uploading.file, size) // therefore, we attempt a check using the hash
                if (!hashed) return // too late, we are working on another file
                if (hashed !== await hashFromServer) return console.debug('upload hash mismatch')
                console.debug('upload hash is matching')
            }
            resuming = true
            console.debug('resuming upload', size.toLocaleString())
            preserveTempFile = undefined
            abortCurrentUpload() // `resuming` will avoid this to be considered skipped
            await wait(500) // be sure the server had the time to react to the abort() and unlocked the file, or our next request will fail
            return startUpload(toUpload, to, size)
        }
        if (name === UPLOAD_REQUEST_STATUS) {
            overrideStatus = data?.[getFilePath(uploading.file)]
            if (overrideStatus >= 400)
                abortCurrentUpload()
            return
        }
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
        closeLastDialog?.()
        closeLastDialog = alertDialog(msg, 'error')?.close
    }

    function workNextFile() {
        stopLooping = true
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
    userAborted = true // must track because abort event isn't trigger if connection isn't established yet
    currentReq?.abort()
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
    entries = entries.map(x => ({ ...x, file: ref(x.file) })) // avoid valtio to mess with File object
    const q = _.find(uploadState.qs, { to })
    if (!q)
        return uploadState.qs.push({ to, entries })
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

async function calcHash(file: File, limit=Infinity) {
    const hash = await hasher()
    const t = Date.now()
    const reader = file.stream().getReader()
    let left = limit
    const updateUI = _.debounce(() => uploadState.hashing = (limit - left) / limit, 100, { maxWait: 500 })
    try {
        while (left > 0) {
            if (uploadState.uploading?.file !== file) return // upload aborted
            const res = await reader.read()
            if (res.done) break
            const chunk = res.value.slice(0, left)
            hash.update(chunk.buffer)
            left -= chunk.length
            updateUI()
            await wait(1) // cooperative: without this, the browser may freeze
        }
    }
    finally {
        updateUI.flush()
        uploadState.hashing = undefined
    }
    const ret = hash.digest().toString(16)
    console.debug('hash calculated in', Date.now() - t, 'ms', ret)
    return ret

    async function hasher() {
        /* using this lib because it's much faster, works on legacy browsers, and we don't need it to be cryptographic. Sure 32bit isn't much.
           Benchmark on 2GB:
                18.5s aws-crypto/sha256-browser
                43.6s js-sha512
                73.3s sha512@hash-wasm
                8.2s xxhash-wasm/64
                8.2s xxhash-wasm/32
                41s xxhashjs/64
                9.1s xxhashjs/32
         */
        //if (BigInt !== Number && BigInt) return (await (await import('xxhash-wasm')).default()).create64() // at 32bit, a 9% difference is not worth having 2 libs, but 64bit is terrible without wasm
        const ret = (await import('xxhashjs')).h32()
        const original = ret.update
        ret.update = (x: Buffer) => original.call(ret, x) // xxhashjs only works with ArrayBuffer, not UInt8Array
        return ret
    }
}


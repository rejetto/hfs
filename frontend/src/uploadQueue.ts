import {
    HTTP_CONFLICT, HTTP_MESSAGES, HTTP_PAYLOAD_TOO_LARGE, HTTP_RANGE_NOT_SATISFIABLE, HTTP_INSUFFICIENT_STORAGE,
    HTTP_PRECONDITION_FAILED, UPLOAD_TEMP_HASH, MTIME_CHECK,
    buildUrlQueryString, getHFS, pathEncode, pendingPromise, prefix, randomId, tryJson, wait, with_,
} from '@hfs/shared'
import { state } from './state'
import { alertDialog, toast } from './dialog'
import { reloadList } from './useFetchList'
import { proxy, ref, snapshot, subscribe } from 'valtio'
import { createElement as h } from 'react'
import _ from 'lodash'
import { UploadStatus } from './upload'
import i18n from './i18n'
const { t } = i18n

export interface ToUpload { file: File, comment?: string, path: string, to?: string, error?: string }
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
const recentSpeedSamples: number[] = []
setInterval(() => {
    const now = Date.now()
    const passed = (now - bytesSentTimestamp) / 1000
    const speed = bytesSent / passed
    if (currentReq && now - stuckSince >= 10_000) { // this will normally cause the upload to be retried after long time of no progress
        currentReq.abort()
        console.debug('upload stuck, aborting')
    }
    bytesSent = 0 // reset counter
    bytesSentTimestamp = now

    // keep track of ETA
    const qBytes = _.sumBy(uploadState.qs, q => _.sumBy(q.entries, x => x.file.size))
    const left = (qBytes  - uploadState.partial)
    const doSample = uploadState.uploading
    if (doSample)
        recentSpeedSamples.push(speed)
    if (!doSample || recentSpeedSamples.length > 5) // max 5 samples, 10 seconds
        recentSpeedSamples.shift()
    if (uploadState.paused)
        recentSpeedSamples.length = 0
    uploadState.speed = _.mean(recentSpeedSamples)
    uploadState.eta = left / uploadState.speed
}, 2_000)

let currentReq: XMLHttpRequest | undefined
const id = randomId()
let userAborted = false
let closeLastDialog: undefined | (() => void)

let reloadOnClose = false
export function resetReloadOnClose() {
    if (!reloadOnClose) return
    reloadOnClose = false
    return true
}

export async function startUpload(toUpload: ToUpload, to: string, resume=0) {
    console.debug('start upload', toUpload.path, resume)
    uploadState.uploading = toUpload
    uploadState.progress = 0
    userAborted = false
    let strictResume = true // ask to reject our request if a better resume is available
    const splitSize = getHFS().splitUploads
    const fullSize = toUpload.file.size
    const uriPath = to + pathEncode(toUpload.path)
    let stopLooping = false // allow callbacks to stop the loop
    do { // at least one iteration, even for empty files
        let req = currentReq = new XMLHttpRequest()
        const requestIsOver = pendingPromise()
        stuckSince = Date.now()
        // beware of 'abort' event: it isn't triggered if connection isn't established yet
        req.onloadend = async () => { // loadend = fired for both success and error. Safari doesn't always fire this on disconnections, leaving readyState = 3. The problem is mitigated by the abort-when-stuck mechanism above.
            try {
                currentReq = undefined
                if (uploadState.paused)
                    return stopLooping = true
                strictResume = true // reset at each request
                if (!userAborted && !req.status) { // we were disconnected, possibly with a status that we couldn't read, so we give it another chance without the body
                    /* Browsers are unreliable when it comes to read the status before the request is fully sent.
                        - chrome139 works for most of the cases. It seems it doesn't when the disconnection happens a bit late (like for file system errors).
                        - safari18 is inconsistent and it seems random.
                        - firefox141 basically never works.
                    */
                    req = new XMLHttpRequest()
                    req.open('PUT', uriPath + queryString + '&simulating=' + body.size, false) // not async this time
                    try { req.send() }
                    catch(e) { console.log(e) }
                    await wait(500) // on a fast connection (localhost) firefox is aborting next request (without the delay), reporting NS_BINDING_ABORTED. Still don't know why
                }
                const { status } = req
                if (status === HTTP_RANGE_NOT_SATISFIABLE)
                    return stopLooping = true
                if (status === HTTP_PRECONDITION_FAILED) { // resume available
                    const size = Number(req.getResponseHeader('x-size'))
                    if (req.getResponseHeader(MTIME_CHECK)) { // mtime check not available
                        const hashFromServer = fetch(uriPath + '?get=' + UPLOAD_TEMP_HASH).then(r => r.text())
                        const hashed = await calcHash(toUpload.file, size) // therefore, we attempt a check using the hash
                        if (hashed !== await hashFromServer) {
                            strictResume = false
                            return console.debug('upload hash mismatch')
                        }
                        console.debug('upload hash is matching')
                    }
                    resume = size
                    return console.debug('resuming upload', size.toLocaleString())
                }
                if (userAborted || status === HTTP_CONFLICT) { // HTTP_CONFLICT = skipped because existing, or upload in progress
                    if (req.responseText === 'retry') // it's our previous request that didn't release the lock yet
                        return await wait(2000) // wait before resolving `finished`
                    toUpload.error = status ? t('upload_conflict', "already exists") : t`Interrupted` // the I is uppercase because we are just recycling an old string (with all its translations)
                    uploadState.skipped.push(toUpload)
                }
                else if (status >= 400)
                    error(status)
                else if (!status) // request failed at a network level, so try again same file (return), but not too often (wait)
                    return await wait(2000) // wait before resolving `finished`
                else {
                    if (splitSize) {
                        resume += splitSize
                        if (resume < fullSize) return // go on with the next chunk
                    }
                    uploadState.done.push({ ...toUpload, response: tryJson(req.responseText) })
                    uploadState.doneByte += toUpload!.file.size
                    reloadOnClose = true
                }
                stopLooping = true
                requestIsOver.then(workNextFile)
            }
            finally {
                requestIsOver.resolve()
            }
        }
        let lastProgress = 0
        req.upload.onprogress = (e:any) => {
            uploadState.partial = e.loaded + resume
            uploadState.progress = uploadState.partial / fullSize
            bytesSent += e.loaded - lastProgress
            if (e.loaded > lastProgress) // some progress = not stuck
                stuckSince = Date.now()
            lastProgress = e.loaded
        }
        const partial = splitSize && resume + splitSize < fullSize
        const queryString = buildUrlQueryString({
            id,
            mtime: toUpload.file.lastModified,
            resume: resume + (strictResume ? '!' : ''),
            partial: partial ? fullSize - resume : undefined, // how much space we need
            comment: toUpload.comment || undefined,
            existing: with_(state.uploadOnExisting, x => x !== 'rename' ? x : undefined), // rename is the default
        })
        req.open('PUT', uriPath + queryString, true)
        const body = toUpload.file.slice(resume, splitSize ? resume + splitSize : undefined)
        req.send(body)
        await requestIsOver
    } while (!stopLooping)

    function error(status: number) {
        const ERRORS = {
            [HTTP_PAYLOAD_TOO_LARGE]: t`file too large` + (getHFS().proxyDetected ?  '\n– ' + t('proxy_413', "Check for this limit on the proxy server") : ''),
            [HTTP_CONFLICT]: t('upload_conflict', "already exists"),
            [HTTP_INSUFFICIENT_STORAGE]: t`insufficient storage`,
        }
        const specifier = (ERRORS as any)[status] || HTTP_MESSAGES[status] || status
        toUpload.error = specifier
        if (uploadState.errors.push(toUpload) > 1) return
        const msg = t('failed_upload', { name: toUpload.path }, "Couldn't upload {name}") + prefix(': ', specifier)
        closeLastDialog?.()
        closeLastDialog = alertDialog(msg, 'error')?.close
    }

    function workNextFile() {
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

export function abortCurrentUpload(userAskedForIt=false) {
    userAborted = userAskedForIt
    currentReq?.abort()
}
subscribe(uploadState, () => {
    const [cur] = uploadState.qs
    if (cur?.entries.length && !uploadState.uploading && !uploadState.paused)
        void startUpload(cur.entries[0], cur.to)
})

export async function enqueueUpload(entries: ToUpload[], to=location.pathname) {
    if (_.remove(entries, x => !simulateBrowserAccept(x.file)).length)
        await alertDialog(t('upload_file_rejected', "Some files were not accepted"), 'warning')

    entries = _.uniqBy(entries, x => x.path)
    if (!entries.length) return
    entries = entries.map(x => ({ ...x, file: ref(x.file) })) // avoid valtio to mess with File object
    const q = _.find(uploadState.qs, { to })
    if (!q)
        return uploadState.qs.push({ to, entries })
    const missing = _.differenceBy(entries, q.entries, x => x.path)
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


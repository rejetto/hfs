// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useState } from 'react'
import { Flex, FlexV } from './components'
import { DialogCloser, formatBytes, hIcon, newDialog, prefix } from './misc'
import _ from 'lodash'
import { proxy, ref, subscribe, useSnapshot } from 'valtio'
import { alertDialog, confirmDialog } from './dialog'
import { reloadList } from './useFetchList'
import { getNotification } from './api'

export const uploadState = proxy<{
    done: number
    doneByte: number
    errors: number
    qs: { to: string, files: File[] }[]
    paused: boolean
    uploading?: File
    progress: number
}>({
    progress: 0,
    paused: false,
    qs: [],
    errors: 0,
    doneByte: 0,
    done: 0,
})

let reloadOnClose = false

export function showUpload() {
    if (!uploadState.qs.length)
        Object.assign(uploadState, {
            errors: 0,
            done: 0,
            doneByte: 0,
        })
    newDialog({
        dialogProps: { style: { minWidth: 'min(20em, 100vw - 1em)' } },
        title: "Upload",
        icon: () => hIcon('upload'),
        Content,
        onClose() {
            if (!reloadOnClose) return
            reloadOnClose = false
            reloadList()
        }
    })

    function Content(){
        const [files, setFiles] = useState([] as File[])
        const { qs, done, doneByte, paused, errors } = useSnapshot(uploadState)
        return h(FlexV, {},
            h(Flex, { gap: '.5em', flexWrap: 'wrap', justifyContent: 'center', position: 'sticky', top: -4, background: 'var(--bg)', boxShadow: '0 3px 3px #000' },
                h('button',{ onClick: () => selectFiles() }, "Add file(s)"),
                h('button',{ onClick: () => selectFiles(true) }, "Add folder"),
                files.length > 1 && h('button', { onClick() { setFiles([]) } }, "Clear"),
                files.length > 0 &&  h('button', {
                    onClick() {
                        const to = location.pathname
                        const ready = _.find(uploadState.qs, { to })
                        if (!ready)
                            uploadState.qs.push({ to, files: files.map(ref) })
                        else {
                            _.remove(ready.files, f => { // avoid duplicates
                                const match = path(f)
                                return Boolean(_.find(files, x => match === path(x)))
                            })
                            ready.files.push(...files.map(ref))
                        }
                        setFiles([])
                    }
                }, `Send ${files.length} file(s), ${formatBytes(files.reduce((a, f) => a + f.size, 0))}`),
            ),
            h(FilesList, {
                files,
                remove(f) {
                    setFiles(files.filter(x => x !== f))
                }
            }),
            h('div', {}, [done && `${done} finished (${formatBytes(doneByte)})`, errors && `${errors} failed`].filter(Boolean).join(' – ')),
            qs.length > 0 && h('div', {},
                h(Flex, { alignItems: 'center', justifyContent: 'center', borderTop: '1px dashed', padding: '.5em' },
                    "Queue",
                    `(${_.sumBy(qs, q => q.files.length)})`,
                    h('button',{
                        onClick(){
                            uploadState.qs = []
                            abortCurrentUpload()
                        }
                    }, "Clear"),
                    h('button',{
                        onClick(){
                            uploadState.paused = !uploadState.paused
                        }
                    }, paused ? "Resume" : "Pause"),
                ),
                qs.map((q,idx) =>
                    h('div', { key: q.to },
                        h('div', {}, "Destination ", decodeURI(q.to)),
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

        function selectFiles(folder=false) {
            const el = Object.assign(document.createElement('input'), {
                type: 'file',
                name: 'file',
                multiple: true,
                webkitdirectory: folder,
            })
            el.addEventListener('change', () =>
                setFiles([ ...files, ...el.files ||[] ] ))
            el.click()
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
    return h('button', { onClick, ...props, ...small && { style: { padding: '.1em', ...style } } }, hIcon(icon))
}

function formatPerc(p: number) {
    return (p*100).toFixed(1) + '%'
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

let req: XMLHttpRequest | undefined
let overrideStatus = 0
let notificationChannel = ''
let notificationSource: EventSource
let closeResumeDialog: DialogCloser | undefined

async function startUpload(f: File, to: string, resume=0) {
    let resuming = false
    overrideStatus = 0
    uploadState.uploading = f
    await subscribeNotifications()
    req = new XMLHttpRequest()
    req.onloadend = () => {
        if (req?.readyState !== 4) return
        const status = overrideStatus || req.status
        if (status) // 0 = user-aborted
            if (status >= 400)
                error()
            else
                done()
        if (!resuming)
            next()
    }
    req.upload.onprogress = (e:any) =>
        uploadState.progress = (e.loaded + resume) / (e.total + resume)
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
                    const msg = `Resume upload? (${formatPerc(size/f.size)} = ${formatBytes(size)})`
                    if (!await confirmDialog(msg, { timeout, getClose: x => closeResumeDialog=x })) return
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

    function error() {
        if (!uploadState.errors++)
            alertDialog("Upload error", 'error').then()
    }

    function done() {
        uploadState.done++
        uploadState.doneByte += f!.size
        reloadOnClose = true
    }

    function next() {
        closeResumeDialog?.()
        uploadState.uploading = undefined
        const { qs } = uploadState
        if (!qs.length) return
        qs[0].files.shift()
        if (!qs[0].files.length)
            qs.shift()
        if (qs.length) return
        reloadList()
        reloadOnClose = false
    }
}

function abortCurrentUpload() {
    req?.abort()
}

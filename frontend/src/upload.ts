// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, useState } from 'react'
import { Flex, FlexV } from './components'
import { formatBytes, hIcon, newDialog, prefix } from './misc'
import _ from 'lodash'
import { proxy, ref, subscribe, useSnapshot } from 'valtio'
import { alertDialog } from './dialog'
import { reloadList } from './useFetchList'

export const uploadState = proxy<{
    done: number
    doneByte: number
    errors: number
    qs: { to: string, files: File[] }[]
    paused: boolean
    uploading?: File
}>({
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
                        h('div', {}, "Destination ", q.to),
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
    const { uploading }  = useSnapshot(uploadState)
    return !files.length ? null : h('table', { className: 'upload-list', width: '100%' },
        h('tbody', {},
            files.map((f,i) =>
                h('tr', { key: i },
                    h('td', {}, iconBtn('trash', () => remove(f))),
                    h('td', {}, formatBytes(f.size)),
                    h('td', { className: f === uploading ? 'ani-working' : undefined }, path(f)),
                ))
        )
    )
}

function iconBtn(icon: string, onClick: () => any, { small=true, style={}, ...props }={}) {
    return h('button', { onClick, ...props, ...small && { style: { padding: '.1em', ...style } } }, hIcon(icon))
}

/// Manage upload queue

let controller: AbortController | undefined
subscribe(uploadState, () => {
    const [cur] = uploadState.qs
    if (cur && !uploadState.uploading && !uploadState.paused)
        startUpload(cur.files[0], cur.to)
})

function startUpload(f: File | undefined, to: string) {
    if (!f) return
    uploadState.uploading = f
    controller = new AbortController()
    const full = path(f, to)
    fetch(full, {
        method: 'PUT',
        body: f,
        signal: controller.signal,
    }).then(async res => {
        if (!res.ok)
            throw Error("Upload failed for " + full)
        uploadState.done++
        uploadState.doneByte += f.size
        reloadOnClose = true
    }).finally(() => {
        uploadState.uploading = undefined
        const { qs } = uploadState
        qs[0].files.shift()
        if (!qs[0].files.length)
            qs.shift()
        if (!qs.length) {
            reloadList()
            reloadOnClose = false
        }
    }).catch(e => {
        if (e.code === 20) return // aborted
        if (!uploadState.errors++)
            alertDialog("Upload error", 'error').then()
    })
}

function abortCurrentUpload() {
    controller?.abort()
}
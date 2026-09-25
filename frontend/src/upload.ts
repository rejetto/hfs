// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, DragEvent, Fragment, useMemo, useState, useEffect, useRef, CSSProperties } from 'react'
import { Btn, Flex, FlexV, iconBtn, Select, Spinner } from './components'
import {
    basename, formatBytes, formatPerc, hIcon, useIsMobile, newDialog, selectFiles, working, workingWith, copyTextToClipboard,
    HTTP_CONFLICT, formatSpeed, getHFS, onlyTruthy, closeDialog, prefix, operationSuccessful, pathEncode,
    getPrefixUrl, HTTP_NOT_FOUND, dirname, UPLOAD_TEMP_PREFIX,
} from './misc'
import _ from 'lodash'
import { INTERNAL_Snapshot, proxy, ref, useSnapshot } from 'valtio'
import { alertDialog, confirmDialog, promptDialog } from './dialog'
import { reloadList } from './useFetchList'
import { apiCall } from '@hfs/shared/api'
import { getUploadOnExisting, state, useSnapState } from './state'
import { Link } from 'wouter'
import { LinkClosingDialog } from './fileMenu'
import {
    abortCurrentUpload, enqueueUpload, getFilePath, normalizeAccept, resetCounters, resetReloadOnClose,
    simulateBrowserAccept, startUpload, ToUpload, uploadState
} from './uploadQueue'
import i18n from './i18n'
const { t } = i18n

const renameEnabled = getHFS().dontOverwriteUploading
const canPickFolder = 'webkitdirectory' in document.createElement('input')
const dropScan = proxy<{ count?: number }>({})

export function showUpload() {
    if (!uploadState.qs.length)
        resetCounters()
    uploadState.uploadDialogIsOpen = true
    const { close } = newDialog({
        dialogProps: { id: 'upload-dialog', style: { minHeight: '6em', minWidth: 'min(20em, 100vw - 1em)' } },
        title: t`Upload`,
        icon: () => hIcon('upload'),
        Content,
        onClose() {
            uploadState.uploadDialogIsOpen = false
            if (resetReloadOnClose())
                reloadList()
        }
    })

    function clear() {
        uploadState.adding.splice(0,Infinity)
    }

    function Content(){
        const { qs, paused, eta, speed, adding } = useSnapshot(uploadState) as Readonly<typeof uploadState>
        const scanning = useSnapshot(dropScan).count !== undefined
        const { props, uploadOnExisting: selectedUploadOnExisting } = useSnapState()
        const uploadOnExisting = getUploadOnExisting(selectedUploadOnExisting, props?.can_overwrite)
        const etaStr = useMemo(() => !eta || eta === Infinity ? '' : formatTime(eta*1000, 0, 2), [eta])
        const inQ = _.sumBy(qs, q => q.entries.length) - (uploadState.uploading ? 1 : 0)
        const queueStr = inQ && t('in_queue', { n: inQ })
        const size = formatBytes(adding.reduce((a, x) => a + x.file.size, 0))
        const isMobile = useIsMobile()

        return h(FlexV, { gap: '.5em' },
            h(FlexV, { className: 'upload-toolbar' },
                props && !props.can_upload ? t`no_upload_here`
                    : h(FlexV, {},
                        h(Flex, { center: true, flexWrap: 'wrap', alignItems: 'stretch' },
                            h('button', {
                                className: 'upload-files',
                                onClick: () => pickFiles({ accept: normalizeAccept(props?.accept) })
                            }, t`Pick files`),
                            canPickFolder && h('button', {
                                className: 'upload-folder',
                                onClick: () => pickFiles({ folder: true })
                            }, t`Pick folder`),
                            h('button', { className: 'create-folder', onClick: createFolder }, t`Create folder`),
                        ),
                        !isMobile && h(Flex, { gap: 4 }, hIcon('info'), t`upload_dd_hint`),
                        h(UploadStatus, { margin: '.5em 0' }),
                        adding.length > 0 && h(Flex, { center: true, flexWrap: 'wrap' },
                            t('ready_to_upload', { n: adding.length, size }),
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
                            h(Flex, {}, // avoid just one button to wrap
                                h('button', {
                                    className: 'upload-send',
                                    disabled: scanning,
                                    onClick() {
                                        void enqueueUpload(uploadState.adding)
                                        clear()
                                    }
                                }, t`Send`),
                                h('button', { disabled: scanning, onClick: clear }, t`Clear`),
                            ),
                        )
                    ),
            ),
            h(FileList, {
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
                        const was = rec.path
                        const s = await promptDialog(t`upload_name`, {
                            value: was,
                            onField: el => {
                                const ofs = was.lastIndexOf('/') + 1 // browsers picking a folder use / as separator even on Windows
                                const end = was.slice(ofs).lastIndexOf('.')
                                el.setSelectionRange(ofs, end < 0 ? was.length : ofs + end)
                            },
                        })
                        if (!s) return
                        rec.path = s
                    },
                },
            }),
            qs.length > 0 && h('div', {},
                h(Flex, { center: true, borderTop: '1px dashed', padding: '.5em' },
                    [etaStr, formatSpeed(speed), queueStr].filter(Boolean).join(', '),
                    inQ > 0 && iconBtn('delete', async () => {
                        const current = uploadState.uploading
                        const to = uploadState.qs[0]?.to
                        uploadState.qs = []
                        await abortCurrentUpload(true)
                        if (current && to && uploadState.partial > 0)
                            await askToRemoveUnfinishedUpload(current, to)
                    }, { title: t`Clear` }),
                    iconBtn(paused ? 'play' : 'pause', () => {
                        uploadState.paused = !uploadState.paused
                        if (uploadState.paused)
                            abortCurrentUpload()
                        else if (uploadState.uploading)
                            startUpload(uploadState.uploading, uploadState.qs[0].to, 0, uploadState.qs[0].existing)
                    }),
                ),
                qs.map((q,idx) =>
                    h('div', { key: q.to },
                        h(Link, { href: q.to, onClick: close }, t`Destination`, ' ', decodeURI(q.to)),
                        h(FileList, {
                            entries: uploadState.qs[idx].entries,
                            actions: {
                                cancel: async f => {
                                    const q = uploadState.qs[idx]
                                    if (f === uploadState.uploading) {
                                        const shouldOfferCleanup = uploadState.partial > 0
                                        if (!uploadState.paused) {
                                            await abortCurrentUpload(true) // wait for the server to register the temp file as unfinished before offering cleanup
                                            return shouldOfferCleanup && askToRemoveUnfinishedUpload(f, q.to)
                                        }
                                        f.error = t`Interrupted`
                                        uploadState.interrupted.push(f)
                                        uploadState.uploading = undefined
                                        if (shouldOfferCleanup)
                                            await askToRemoveUnfinishedUpload(f, q.to)
                                    }
                                    _.pull(q.entries, f)
                                    if (!q.entries.length)
                                        uploadState.qs.splice(idx,1)
                                }
                            }
                        }),
                    ))
            )
        )

        async function askToRemoveUnfinishedUpload(f: ToUpload, to: string) {
            if (!await confirmDialog(t`delete_unfinished_upload`))
                return
            const dir = dirname(f.path)
            await apiCall('delete', {}, {
                restUri: to + pathEncode(prefix('', dir, '/') + UPLOAD_TEMP_PREFIX + basename(f.path).slice(-200))
            }).then(reloadList, e => {
                if (e?.code === HTTP_NOT_FOUND)
                    return
                alertDialog(e, 'error')
            })
        }

        function pickFiles(options: Parameters<typeof selectFiles>[1]) {
            selectFiles(list => {
                uploadState.adding.push( ...Array.from(list || []).filter(x => simulateBrowserAccept(x))
                    .map(f => ({ file: ref(f), path: getFilePath(f) })) )
            }, options)
        }
    }

}

function FileList({ entries, actions }: { entries: ToUpload[], actions: { [icon:string]: null | ((rec :ToUpload) => any) } }) {
    const { uploading, progress, partial, hashing }  = useSnapshot(uploadState)
    const snapEntries = useSnapshot(entries)
    const firstBatch = useRef(0)
    const [all, setAll] = useState(false)
    // freeze the first render budget so later scan batches only update the lightweight "more" row
    firstBatch.current ||= Math.min(snapEntries.length, 100)
    useEffect(() => {
        setAll(false)
        if (!entries.length)
            firstBatch.current = 0
    }, [entries.length])
    const max = all ? Infinity : firstBatch.current
    const rest = Math.max(0, snapEntries.length - max)
    const title = formatPerc(progress)
    return !snapEntries.length ? null : h('table', { className: 'upload-list', width: '100%' },
        h('tbody', {},
            snapEntries.slice(0, max).map((e, i) => {
                const working = e.file === uploading?.file // e is a proxy, so we check 'file' as it's a ref
                return h(Fragment, { key: i },
                    h('tr', {},
                        h('td', { className: 'nowrap upload-list-actions' },
                            h('span', { className: 'upload-list-inline-actions' }, ..._.map(actions, (cb, icon) =>
                                cb && iconBtn(icon, () => cb(entries[i]), { className: `action-${icon}` })) ),
                            iconBtn('menu', () => openUploadActions(entries[i], actions), { className: 'upload-list-menu-button' }),
                        ),
                        h('td', { className: 'upload-list-size' }, formatBytes(e.file.size)),
                        h('td', {},
                            h('span', {}, e.path),
                            working && h('span', { className: 'upload-progress', title }, formatBytes(partial)),
                            working && hashing && h('span', { className: 'upload-hashing' }, t`Considering resume`, ' (', formatPerc(hashing), ')'),
                            working && h('progress', { className: 'upload-progress-bar', title, max: 1, value: _.round(progress, 3)  }), // round for fewer dom updates
                        ),
                    ),
                    e.comment && h('tr', {}, h('td', { colSpan: 3 }, h('div', { className: 'entry-comment' }, e.comment)) )
                )
            }),
            rest > 0 && h('tr', {}, h('td', { colSpan: 99 }, h(Btn, { asText: true, label: t('more_items', { n: rest }), onClick: () => setAll(true) })))
        )
    )
}

function openUploadActions(rec: ToUpload, actions: { [icon:string]: null | ((rec :ToUpload) => any) }) {
    const { close } = newDialog({
        title: t`Menu`,
        icon: () => hIcon('menu'),
        Content() {
            return h(Fragment, {},
                h('dl', { className: 'file-dialog-properties upload-action-properties' },
                    h('div', {},
                        h('dt', {}, t`Size`),
                        h('dd', {}, formatBytes(rec.file.size))
                    )
                ),
                h('div', { className: 'upload-action-menu file-menu' },
                    ..._.map(actions, (cb, icon) => cb && h('a', {
                        href: '#',
                        className: `action-${icon}`,
                        onClick(ev) {
                            ev.preventDefault()
                            close()
                            void cb(rec)
                        }
                    },
                        hIcon(icon),
                        h('label', {}, uploadActionLabel(icon))
                    ))
                )
            )
        }
    })
}

function uploadActionLabel(icon: string) {
    // edit changes the upload path, so users see the familiar rename label
    return icon === 'edit' ? t`Rename` : t(_.capitalize(icon))
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


export function UploadStatus({ snapshot, ...props }: { snapshot?: INTERNAL_Snapshot<typeof uploadState> } & CSSProperties) {
    const current = useSnapshot(uploadState)
    const { done, doneByte, errors, interrupted } = snapshot || current
    const msgDone = done.length > 0 && t('upload_finished', { n: done.length, size: formatBytes(doneByte) })
    const msgInterrupted = interrupted.length > 0 && t('upload_interrupted', { n: interrupted.length })
    const msgErrors = errors.length > 0 && t('upload_errors', { n: errors.length })
    const msg = [msgDone, msgInterrupted, msgErrors].filter(Boolean).join(' – ')
    if (!msg) return null
    const sep = h('span', { className: 'horiz-sep' }, ' – ')
    return h('div', { style: { ...props } },
        msg, sep, h(Btn, { label: t`Show details`, asText: true, onClick: showDetails }),
        sep, h(Btn, {
            label: t`copy_links`,
            asText: true,
            successFeedback: true,
            async onClick() {
                await copyTextToClipboard(done.map(x => location.origin + getPrefixUrl() + x.response.uri).join('\n'))
                operationSuccessful()
            }
        }),
    )

    function showDetails() {
        if (!uploadState.uploadDialogIsOpen)
            closeDialog() // don't nest dialogs unnecessarily (apply only to the dialog outside upload-dialog)
        alertDialog(h('div', {},
            ([
                [msgDone, done],
                [msgInterrupted, interrupted],
                [msgErrors, errors]
            ] as const).map(([msg, list], i) =>
                msg && h('div', { key: i }, msg, h('ul', {},
                    list.map((x, i) =>
                        h('li', { key: i }, x.path, prefix(' (', x.error, ')'))
                )))
            )
        ))
    }
}

export function acceptDropFiles(makeConsumer: false | undefined | (() => (files: ToUpload[]) => void)) {
    return {
        onDragOver(ev: DragEvent) {
            ev.preventDefault()
            ev.dataTransfer!.dropEffect = makeConsumer && dropScan.count === undefined
                && ev.dataTransfer.types.includes('Files') ? 'copy' : 'none'
        },
        onDrop(ev: DragEvent) {
            ev.preventDefault()
            if (!makeConsumer || dropScan.count !== undefined) return
            const staging = uploadState.uploadDialogIsOpen
            const stopWorking = staging ? startDropScan() : undefined
            const acceptFiles = makeConsumer() // preserve staging, destination and filters while the asynchronous scan runs
            const files: ToUpload[] = []
            // per-file Valtio updates freeze large drops; report progress at most once per second and flush on completion
            const flush = _.throttle(() => {
                const batch = files.splice(0)
                if (staging)
                    dropScan.count = (dropScan.count || 0) + batch.length
                acceptFiles(batch)
            }, 1_000, { leading: false })
            const pending: Promise<void>[] = []
            for (const it of ev.dataTransfer.items) {
                const entry = it.webkitGetAsEntry()
                if (entry)
                    pending.push(readEntry(entry))
            }
            void Promise.allSettled(pending).then(() => {
                flush.flush()
                if (staging) {
                    dropScan.count = undefined
                    stopWorking?.()
                }
            })

            async function readEntry(entry: FileSystemEntry, to = ''): Promise<void> {
                if (entry.isFile)
                    return new Promise((resolve, reject) => (entry as FileSystemFileEntry).file(file => {
                        files.push({ file, path: (file.webkitRelativePath ? '' : to) + getFilePath(file) }) // Firefox supplies the path itself; Chromium needs `to`
                        flush()
                        resolve()
                    }, reject))

                const reader = (entry as FileSystemDirectoryEntry).createReader?.()
                const entries: FileSystemEntry[] = []
                while (reader) {
                    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
                    if (!batch.length) break // directory readers signal completion with an empty batch
                    entries.push(...batch)
                }
                await Promise.allSettled(entries.map(x => readEntry(x, to + entry.name + '/')))
            }
        },
    }
}

function startDropScan() {
    dropScan.count = 0
    return workingWith(function DropScanProgress() {
        const count = useSnapshot(dropScan).count || 0
        return h(FlexV, { center: true, props: { role: 'status', tabIndex: 0 } },
            h(Spinner),
            t('scanning_files', { n: count }, "Scanning files: {n}"),
        )
    })
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
                h(LinkClosingDialog, { to: uri + pathEncode(name) + '/' }, t`enter_folder`),
            )))
    }
    catch(e: any) {
        await alertDialog(e.code === HTTP_CONFLICT ? t`folder_exists` : e)
    }
}

export function inputComment(filename: string, value?: string) {
    return promptDialog(t('enter_comment', { name: filename }), { value, type: 'textarea' })
}

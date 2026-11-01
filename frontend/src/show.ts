import { DirEntry, DirList, ext2type, state, useSnapState } from './state'
import { createElement as h, forwardRef, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
    basename, dirname, domOn, hfsEvent, hIcon, isMac, newDialog, pathEncode, restartAnimation, useStateMounted,
    isNumeric, safeDecodeURIComponent, isAudioComponent,
} from './misc'
import { useEventListener, useWindowSize } from 'usehooks-ts'
import { EntryDetails, useMidnight } from './BrowseFiles'
import { Btn, FlexV, iconBtn, Spinner } from './components'
import { openFileMenu } from './fileMenu'
import { deleteFiles } from './menu'
import { alertDialog, toast } from './dialog'
import _ from 'lodash'
import { getId3Tags } from './id3'
import i18n from './i18n'
const { t, useI18N } = i18n

enum ZoomMode {
    fullWidth,
    freeY,
    contain, // leave this as last
}

// return falsy if entry is not supported
export function fileShow(entry: DirEntry, { startPlaying=false, startShuffle=false } = {}) {
    if (!getShowComponent(entry))
        return
    let escOnce = false
    let onClose: any
    let firstUri: string
    let playMsgOnce = true
    let justOpen = true
    const { close } = newDialog({
        noFrame: true,
        className: 'file-show',
        onClose() {
            onClose?.()
        },
        Content() {
            useEffect(() => {
                const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!
                const original = viewport.content
                viewport.content = 'width=device-width, initial-scale=1' // allow native pinch zoom in the viewer, restoring the list's policy on close
                return () => { viewport.content = original }
            }, [])
            const { uri, list } = useSnapState()
            useEffect(() => {
                if (uri === firstUri) return
                firstUri ??= uri // init
                if (firstUri !== uri) // user must have clicked the folder link inside file-menu (which happens only for search results)
                    close()
            }, [uri])
            const initialShuffle = useMemo(() => startShuffle ? _.shuffle(state.list) : undefined, [])
            const [cur, setCur, getCur] = useStateMounted(initialShuffle?.[0] || entry)
            const moving = useRef(0)
            const lastGood = useRef(entry)
            const [mode, setMode] = useState(ZoomMode.contain)
            const [shuffle, setShuffle] = useState<undefined | DirList>(initialShuffle)
            useEffect(() => {
                const sameKey = _.find(state.list, { key: cur.key || cur.n }) // rename replaces the list entry to preserve list focus, so follow that replacement in the viewer
                if (!sameKey || sameKey.n === cur.n) return // different name?
                setShuffle(x => x?.map(entry => entry.n === cur.n ? sameKey : entry))
                goTo(sameKey)
            }, [list, cur])
            const shufflePlayed = useRef(0) // keep track of how many entries of the shuffle list we played
            if (!shuffle) shufflePlayed.current = 0
            const [repeat, setRepeat] = useState(false)
            const nextPlan = useMemo(getNextPlan, [cur, shuffle, repeat, list])
            const nextPlanRef = useRef(nextPlan)
            nextPlanRef.current = nextPlan
            useEffect(() => {
                if (nextPlan.order !== shuffle)
                    setShuffle(nextPlan.order)
            }, [nextPlan.order])
            useEffect(() => {
                if (nextPlan.ready)
                    hfsEvent('showNext', { current: cur, next: nextPlan.next })
            }, [cur, nextPlan.next, nextPlan.ready])
            const [cover, setCover] = useState('')
            useEventListener('keydown', ({ key }) => {
                if (key === 'Escape') {
                    if (escOnce)
                        return close()
                    escOnce = true
                    onClose = toast(t`esc_again`).close
                    return
                }
                escOnce = false
                if (key === 'ArrowLeft') return goPrev()
                if (key === 'ArrowRight') return goNext()
                if (key === 'ArrowDown') return scrollY(1)
                if (key === 'ArrowUp') return scrollY(-1)
                if (key === 'd') return location.href = cur.uri + '?dl'
                if (key === 'z') return switchZoomMode()
                if (key === 'f') return toggleFullScreen()
                if (key === 's') return toggleShuffle()
                if (key === 'r') return toggleRepeat()
                if (key === 'a') return toggleAutoPlay()
                if (key === ' ') {
                    const sel = state.selected
                    if (sel[cur.uri])
                        delete sel[cur.uri]
                    else
                        sel[cur.uri] = true
                    state.showFilter = true
                    return
                }
            })
            const [showNav, setShowNav] = useState(false)
            const component = useMemo(() => getShowComponent(cur), [cur])
            const isAudio = isAudioComponent(component)
            useEffect(() => setShowNav(isAudio), [isAudio])
            const timerRef = useRef(0)
            const navClass = 'nav' + (showNav ? '' : ' nav-hidden')

            const [loading, setLoading] = useState(false)
            const [failed, setFailed] = useState<false | string>(false)
            const [limited, setLimited] = useState(false)
            const [reload, setReload] = useState(0)
            const [checking, setChecking] = useState(false)
            const retried = useRef(false)
            const probe = useMemo(() => ({ controller: new AbortController(), pending: false }), [cur, reload])
            useEffect(() => () => probe.controller.abort(), [probe]) // cancel only this attempt, not a new file's probe started before cleanup
            const containerRef = useRef<HTMLDivElement>()
            const mainRef = useRef<HTMLDivElement>()
            useEffect(() => { scrollY(-1E9) }, [cur])

            const [tags, setTags] = useState<any>()
            useEffect(() => setTags(undefined), [cur]) // reset

            const { auto_play_seconds, autoPlay } = useSnapState()
            const [autoPlaying, setAutoPlaying] = useState(startPlaying || autoPlay)
            function getShowElement() {
                return containerRef.current?.querySelector('.showing') // like this, we don't require component to forward ref (easier for plugins)
            }
            useEffect(() => {
                const showElement = getShowElement()
                const playOnOpen = justOpen
                justOpen = false
                if (!showElement || failed || checking || !autoPlaying && !playOnOpen) return
                if (showElement instanceof HTMLMediaElement) {
                    showElement.play().catch(playFailed)
                    if (autoPlaying)
                        return domOn('ended', goNext, { target: showElement })
                    return
                }
                if (!autoPlaying) return // we reached here because of the justOpen, but we are not interested in images
                // we are supposedly showing an image
                const h = setTimeout(goNext, state.auto_play_seconds * 1000)
                return () => clearTimeout(h)
            }, [autoPlaying, cur, reload, failed, checking])
            const {mediaSession} = navigator
            mediaSession?.setActionHandler('nexttrack', goNext)
            mediaSession?.setActionHandler('previoustrack', goPrev)

            const {t} = useI18N()
            const autoPlaySecondsLabel = t`autoplay_seconds`
            const folder = dirname(cur.n)
            const failOnce = useRef<typeof cur>()
            useEffect(() => {
                if (component || failOnce.current === cur) return
                onError()
                failOnce.current = cur
            }, [cur, component])
            return h(FlexV, {
                gap: 0,
                alignItems: 'stretch',
                className: isAudio ? undefined : ZoomMode[mode], // we don't want zoom on audio
                props: {
                    role: 'dialog',
                    onMouseMove() {
                        if (isAudio) return
                        setShowNav(true)
                        clearTimeout(timerRef.current)
                        timerRef.current = +setTimeout(() => setShowNav(false), 1_000)
                    }
                }
            },
                h('div', { className: 'bar' },
                    h('div', { className: 'filename' }, h('span', { className: 'folder' }, folder), cur.n.slice(folder.length)),
                    cur.comment && h('div', { className: 'entry-comment' }, cur.comment),
                    h('div', { className: 'controls' }, // keep on same row
                        h(EntryDetails, { entry: cur, midnight: useMidnight() }),
                        useWindowSize().width > 800 && iconBtn('?', showHelp),
                        h('div', {}, // fuse buttons
                            h(Btn, {
                                className: 'small',
                                label: t`Auto-play`,
                                toggled: autoPlaying,
                                onClick: toggleAutoPlay,
                            }),
                            autoPlaying && h(Btn, {
                                className: 'small',
                                label: String(auto_play_seconds),
                                title: autoPlaySecondsLabel,
                                onClick: configAutoPlay,
                            }),
                        ),
                        iconBtn('menu', ev => openFileMenu(cur, ev, [
                            'open',
                            cur.canDelete() && { id: 'delete', label: t`Delete`, icon: 'delete', onClick: deleteCurrent },
                            { id: 'zoom', icon: 'zoom', label: t`Switch zoom mode`, onClick: switchZoomMode },
                            { id: 'fullscreen', icon: 'fullscreen', label: t`Full screen`, onClick: toggleFullScreen },
                            { id: 'shuffle', icon: 'shuffle', label: t`Shuffle`, toggled: Boolean(shuffle), onClick: () => toggleShuffle() },
                            { id: 'repeat', icon: 'repeat', label: t`Repeat`, toggled: repeat, onClick: toggleRepeat },
                        ])),
                        iconBtn('close', close),
                    ),
                ),
                h(FlexV, { center: true, alignItems: 'center', className: 'main', ref: mainRef },
                    loading && h(Spinner, { style: { position: 'absolute', fontSize: '20vh', opacity: .5 } }),
                    failed === cur.n ? h(FlexV, { alignItems: 'center', textAlign: 'center' },
                        hIcon('error', { style: { fontSize: '20vh' } }),
                        h('div', {}, cur.name),
                        h('div', {}, limited ? t`Download limit reached` : t`Loading failed`),
                        limited && h(Btn, { label: t`Retry`, onClick: retry })
                    ) : h('div', { className: 'showing-container', ref: containerRef },
                        h('div', {
                            className: 'cover ' + (cover ? '' : 'none'),
                            style: { backgroundImage: cover && `url("${cover}")` }
                        }),
                        component && h(component, {
                            key: reload,
                            src: cur.uri,
                            className: 'showing',
                            onLoad() {
                                lastGood.current = cur
                                setLoading(false)
                            },
                            onError,
                            async onPlay() {
                                const covers = !isAudio ? [] : state.list.filter(x => folder === dirname(x.n) // same folder
                                    && x.name.match(/(?:folder|cover|front|albumart.*)\.jpe?g$/i))
                                setCover(pathEncode(_.maxBy(covers, 's')?.n || ''))
                                const meta = {
                                    title: cur.name,
                                    album: safeDecodeURIComponent(basename(dirname(cur.uri)), ''),
                                    artwork: covers.map(x => ({ src: x.n }))
                                }
                                const m = window.MediaMetadata && (navigator.mediaSession.metadata = new MediaMetadata(meta))
                                if (cur.ext === 'mp3') {
                                    const arr = cur.name.split(' - ') // "artist - title" is quite common for mp3s
                                    setTags(Object.assign(meta, {
                                        title: arr.at(-1)?.slice(0, -4), // last part, without extension
                                        artist: arr.filter(x => !isNumeric(x)).at(-2), // previous part, if any and not numeric
                                        ...await getId3Tags(location.pathname + cur.n).catch(() => {})
                                    }))
                                    if (m) Object.assign(m, meta)
                                }
                                hfsEvent('showPlay', {
                                    entry: cur,
                                    meta,
                                    setCover(src: any) {
                                        if (typeof src !== 'string') return
                                        setCover(src)
                                        if (m) navigator.mediaSession.metadata = new MediaMetadata(Object.assign(meta, { artwork: [{ src }] }))
                                    }
                                })
                            }
                        }),
                        tags && h('div', { className: 'meta-tags' },
                            h('div', {}, // extra div for allowing position:relative+absolute
                                ...['title','artist','album','year'].map(k => h('div', { key: k, className: `meta-${k}` }, tags[k])) ) ),
                    ),
                    hIcon('❮', { className: navClass, style: { left: 0 }, onClick: goPrev }),
                    hIcon('❯', { className: navClass, style: { right: 0 }, onClick: goNext }),
                ),
            )

            function goPrev() { go(-1) }

            function goNext() { go(+1) }

            async function deleteCurrent() {
                const list = shuffle || state.list
                const i = _.findIndex(list, { n: cur.n })
                const canShow = (entry: DirEntry) => !entry.isFolder && Boolean(getShowComponent(entry))
                const next = _.find(list.slice(i + 1), canShow) || _.findLast(list.slice(0, i), canShow)
                if (!await deleteFiles([cur.uri])) return
                if (shuffle)
                    setShuffle(list.filter(x => x.n !== cur.n))
                next ? goTo(next) : close()
            }

            async function onError() {
                if (!component) return loadingFailed()
                const { controller } = probe
                if (probe.pending || controller.signal.aborted) return
                probe.pending = true
                setChecking(true)
                // media error events hide HTTP status; HEAD checks the current limit without downloading the file
                const response = await fetch(cur.uri, { method: 'HEAD', cache: 'no-store', signal: controller.signal }).catch(() => undefined)
                if (controller.signal.aborted || getCur() !== cur) return
                probe.pending = false
                setChecking(false)
                if (response?.status === 429) {
                    setAutoPlaying(false)
                    setLoading(false)
                    setLimited(true)
                    setFailed(cur.n)
                }
                else if (response?.ok && !retried.current) {
                    retried.current = true // a slot may have freed up, but a broken file must not cause endless retries
                    retry()
                }
                else loadingFailed()
            }

            function retry() {
                setFailed(false)
                setLimited(false)
                setLoading(true)
                setReload(x => x + 1)
            }

            function loadingFailed() {
                const mediaError = (document.querySelector('.showing-container .showing') as any)?.error?.code // only present in video/audio elements
                if (mediaError === 2) return // happens when chrome fails to fetch cover for videos. We don't skip the file for this reason. Tested on chrome129/windows
                if (cur !== lastGood.current)
                    return go(moving.current || 1)
                setLoading(false)
                setFailed(cur.n)
            }

            function playFailed(err?: Error) {
                console.debug(err)
                if (err?.name !== 'NotAllowedError') return // browser won't allow automatic audio playing without user interaction...
                if (!playMsgOnce) return
                playMsgOnce = false
                const el = getShowElement()
                if (!(el instanceof HTMLMediaElement)) return
                const mel = el as HTMLMediaElement
                const dlg =  newDialog({ // ...so we offer a simple dialog with a button
                    onClose: () => playMsgOnce = true,
                    Content: () => h(Btn, {
                        autoFocus: true,
                        icon: 'play',
                        label: "Click here to play",
                        onClick: () => {
                            mel.play().catch(playFailed)
                            dlg.close()
                        }
                    })
                })
            }

            function go(dir=1) {
                if (getCur() !== cur) return // this was fired with a stale state (closure), cancel. To reproduce: hold right-arrow on the keyboard
                if (dir)
                    moving.current = dir
                const latestPlan = nextPlanRef.current
                if (!latestPlan.ready) return
                const workingShuffle = latestPlan.order
                const e = dir > 0 ? latestPlan.next : findNext(cur, -1, workingShuffle || state.list)
                if (!e) {
                    if (dir > 0)
                        setAutoPlaying(false)
                    goTo(lastGood.current) // revert to last known supported file
                    return restartAnimation(document.body, '.2s blink')
                }
                goTo(e)
                if (workingShuffle) {
                    const playingIdx = _.findIndex(workingShuffle, { n: e.n })
                    shufflePlayed.current = Math.max(shufflePlayed.current, playingIdx)
                }
            }

            function getNextPlan() {
                let order = shuffle
                const shuffleIdx = order ? _.findIndex(order, { n: cur.n }) : -1
                if (order && shuffleIdx >= shufflePlayed.current && order.length < state.list.length) {
                    const announced = findNext(cur, 1, order)
                    const keepThrough = announced ? _.findIndex(order, { n: announced.n }) + 1 : shuffleIdx + 1
                    const fixed = order.slice(0, keepThrough)
                    // preserve the announced next while adding files received after the initial partial listing
                    order = fixed.concat(_.shuffle(_.difference(state.list, fixed)))
                }
                const entries = order || state.list
                const ready = _.findIndex(entries, { n: cur.n }) >= 0
                return { order, ready, next: ready ? findNext(cur, 1, entries, repeat) : undefined }
            }

            function findNext(from: DirEntry, direction: 1 | -1, entries: DirList, wrap=false) {
                let i = _.findIndex(entries, { n: from.n })
                if (i < 0) return
                for (let checked = 0; checked < entries.length; checked++) {
                    i += direction
                    if (i < 0 || i >= entries.length) {
                        if (!wrap || direction < 0) return
                        i = 0
                    }
                    const entry = entries[i]
                    if (!entry.isFolder && getShowComponent(entry))
                        return entry
                }
            }

            function goTo(to: typeof cur) {
                if (to !== cur) probe.controller.abort()
                setChecking(false)
                retried.current = false
                setLimited(false)
                setFailed(false)
                setLoading(to !== lastGood.current)
                setCur(to)
            }

            function toggleFullScreen() {
                if (!document.fullscreenEnabled)
                    return alertDialog(t`Full-screen not supported`, 'error')
                if (document.fullscreenElement)
                    document.exitFullscreen()
                else
                    mainRef.current?.requestFullscreen()
            }

            function switchZoomMode() {
                setMode(x => x ? x - 1 : ZoomMode.contain)
            }

            function toggleShuffle(force?: boolean) {
                if (!(force ?? !shuffle))
                    return setShuffle(undefined)
                const order = _.shuffle(state.list)
                setShuffle(order)
                goTo(order[0])
            }

            function toggleRepeat() {
                setRepeat(x => !x)
            }

            function toggleAutoPlay() {
                setAutoPlaying(x => state.autoPlay = !x)
            }

            function scrollY(dy: number) {
                containerRef.current?.scrollBy(0, dy * .5 * containerRef.current?.clientHeight)
            }

            function configAutoPlay() {
                newDialog({
                    title: t`Auto-play`,
                    Content() {
                        const { auto_play_seconds } = useSnapState()
                        return h(FlexV, {},
                            autoPlaySecondsLabel,
                            h('input', {
                                type: 'number',
                                min: 1,
                                max: 10000,
                                value: auto_play_seconds,
                                style: { width: '4em' },
                                onChange: ev => state.auto_play_seconds = Number(ev.target.value)
                            })
                        )
                    }
                })
            }
        }
    })
    return true
}

export function getShowComponent(entry: DirEntry) {
    const type = ext2type(entry.ext)
    const Component = type === 'audio' ? Audio
        : type === 'video' ? Video
        : type === 'image' ? 'img'
        : ''
    const params = { entry, Component }
    const res = hfsEvent('fileShow', params).findLast(Boolean)
    return res || params.Component
}

export const Audio = forwardRef<HTMLVideoElement, any>(({ onLoad, ...rest }: any, ref) =>
    h('audio', { ref, onLoadedData: onLoad, controls: true, ...rest }) )

export const Video = forwardRef<HTMLVideoElement, any>(({ onLoad, ...rest }: any, ref) =>
    h('video', { ref, onLoadedData: onLoad, controls: true, ...rest }) )

function showHelp() {
    newDialog({
        title: t`File Show help`,
        className: 'file-show-help',
        Content: () => h(Fragment, {},
            t('showHelpMain', {}),
            _.map({
                "←/→": t`showHelp_←/→_body`,
                "↑/↓": t`showHelp_↑/↓_body`,
                "space": t`Select`,
                "D": t`Download`,
                "Z": t`Switch zoom mode`,
                "F": t`Full screen`,
                "S": t`Shuffle`,
                "R": t`Repeat`,
                "A": t`Auto-play`,
            }, (v,k) => h('div', { key: k }, h('kbd', {}, t('showHelp_' + k, k)), ' ', v) ),
            h('div', { style: { marginTop: '1em' } },
                t('showHelpListShortcut', { key: isMac ? 'SHIFT' : 'WIN' })
            )
        )
    })
}

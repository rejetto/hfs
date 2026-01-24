import { DirEntry, DirList, ext2type, state, useSnapState } from './state'
import { createElement as h, forwardRef, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
    basename, dirname, domOn, hfsEvent, hIcon, isMac, newDialog, pathEncode, restartAnimation, useStateMounted,
    isNumeric, safeDecodeURIComponent,
} from './misc'
import { useEventListener, useWindowSize } from 'usehooks-ts'
import { EntryDetails, useMidnight } from './BrowseFiles'
import { Btn, FlexV, iconBtn, Spinner } from './components'
import { openFileMenu } from './fileMenu'
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
            const { uri } = useSnapState()
            useEffect(() => {
                if (uri === firstUri) return
                firstUri ??= uri // init
                if (firstUri !== uri) // user must have clicked the folder link inside file-menu (which happens only for search results)
                    close()
            }, [uri])
            const [cur, setCur, getCur] = useStateMounted(entry)
            const moving = useRef(0)
            const lastGood = useRef(entry)
            const [mode, setMode] = useState(ZoomMode.contain)
            const [shuffle, setShuffle] = useState<undefined | DirList>()
            useEffect(() => toggleShuffle(startShuffle), [])
            const shufflePlayed = useRef(0) // keep track of how many entries of the shuffle list we played
            if (!shuffle) shufflePlayed.current = 0
            const [repeat, setRepeat, getRepeat] = useStateMounted(false)
            const [cover, setCover] = useState('')
            useEffect(() => {
                if (shuffle)
                    goTo(shuffle[0])
            }, [Boolean(shuffle)])
            useEventListener('keydown', ({ key }) => {
                if (key === 'Escape') {
                    if (escOnce)
                        return close()
                    escOnce = true
                    onClose = toast(t('esc_again', "Press ESC twice to close")).close
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
            const isAudio = component === Audio
            useEffect(() => setShowNav(isAudio), [isAudio])
            const timerRef = useRef(0)
            const navClass = 'nav' + (showNav ? '' : ' nav-hidden')

            const [loading, setLoading] = useState(false)
            const [failed, setFailed] = useState<false | string>(false)
            const containerRef = useRef<HTMLDivElement>()
            const mainRef = useRef<HTMLDivElement>()
            useEffect(() => { scrollY(-1E9) }, [cur])

            const [tags, setTags] = useState<any>()
            useEffect(() => setTags(undefined), [cur]) // reset

            const { auto_play_seconds } = useSnapState()
            const [autoPlaying, setAutoPlaying] = useState(startPlaying)
            function getShowElement() {
                return containerRef.current?.querySelector('.showing') // like this, we don't require component to forward ref (easier for plugins)
            }
            useEffect(() => {
                const showElement = getShowElement()
                try {
                    if (!autoPlaying && !justOpen || !showElement) return
                } finally {
                    justOpen = false
                }
                if (showElement instanceof HTMLMediaElement) {
                    showElement.play().catch(playFailed)
                    return domOn('ended', goNext, { target: showElement })
                }
                if (!autoPlaying) return // we reached here because of the justOpen, but we are not interested in images
                // we are supposedly showing an image
                const h = setTimeout(goNext, state.auto_play_seconds * 1000)
                return () => clearTimeout(h)
            }, [autoPlaying, cur])
            const {mediaSession} = navigator
            mediaSession?.setActionHandler('nexttrack', goNext)
            mediaSession?.setActionHandler('previoustrack', goPrev)

            const {t} = useI18N()
            const autoPlaySecondsLabel = t('autoplay_seconds', "Seconds to wait on images")
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
                    h('div', { className: 'filename' }, h('small', {}, folder), cur.n.slice(folder.length)),
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
                            'open', 'delete',
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
                        t`Loading failed`
                    ) : h('div', { className: 'showing-container', ref: containerRef },
                        h('div', {
                            className: 'cover ' + (cover ? '' : 'none'),
                            style: { backgroundImage: cover && `url("${cover}")` }
                        }),
                        component && h(component, {
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

            function onError() {
                const mediaError = (document.querySelector('.showing-container .showing') as any)?.error?.code // only present in video/audio elements
                if (mediaError === 2) return // happens when chrome fails to fetch cover for videos. We don't skip the file for this reason. Tested on chrome129/windows
                if (cur !== lastGood.current)
                    return go()
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
                const { list } = state
                /* this is a lazy approach to shuffling: since list is not fully available from the start, it's best to wait,
                   or the shuffle will be limited to a few entries. Benchmark: _.shuffle of 1M entries takes 10ms on a M1 pro. */
                let workingShuffle = shuffle // in case we setShuffle, we need to do the rest of job with fresh data
                // if playing shuffle, and going forward, where never played before, and got new entries since last time, then shuffle again
                if (shuffle && dir > 0 && shuffle.length < list.length) {
                    const shuffleIdx = _.findIndex(shuffle, { n: cur.n })
                    if (shuffleIdx >= shufflePlayed.current) {
                        const ofs = 1 + shuffleIdx
                        const played = shuffle.slice(0, ofs) // keep the part already played, shuffle the rest
                        setShuffle(workingShuffle = played.concat(_.shuffle(_.difference(list, played))))  // list has unstable order (when searching), so we use difference
                    }
                }
                if (dir)
                    moving.current = dir
                let e = cur
                while (1) {
                    e = e.getSibling(moving.current, workingShuffle)
                    if (anyGood()) break
                    if (e) continue // try next
                    // reached last/first
                    if (dir! > 0) {
                        if (getRepeat()) {
                            e = workingShuffle?.[0] || list[0]
                            if (anyGood()) break
                            continue
                        }
                        setAutoPlaying(false)
                    }
                    goTo(lastGood.current) // revert to last known supported file
                    return restartAnimation(document.body, '.2s blink')
                }
                goTo(e)
                if (shuffle) {
                    const playingIdx = _.findIndex(workingShuffle, { n: e.n })
                    shufflePlayed.current = Math.max(shufflePlayed.current, playingIdx)
                }

                function anyGood() {
                    return e && !e.isFolder && getShowComponent(e)
                }
            }

            function goTo(to: typeof cur) {
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
                setShuffle(x => (force ?? !x) ? _.shuffle(state.list) : undefined)
            }

            function toggleRepeat() {
                setRepeat(x => !x)
            }

            function toggleAutoPlay() {
                setAutoPlaying(x => !x)
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
            t('showHelpMain', {}, "You can use the keyboard for some actions:"),
            _.map({
                "←/→": t('showHelp_←/→_body', "Go to previous/next file"),
                "↑/↓": t('showHelp_↑/↓_body', "Scroll tall images"),
                "space": t`Select`,
                "D": t`Download`,
                "Z": t`Switch zoom mode`,
                "F": t`Full screen`,
                "S": t`Shuffle`,
                "R": t`Repeat`,
                "A": t`Auto-play`,
            }, (v,k) => h('div', { key: k }, h('kbd', {}, t('showHelp_' + k, k)), ' ', v) ),
            h('div', { style: { marginTop: '1em' } },
                t('showHelpListShortcut', { key: isMac ? 'SHIFT' : 'WIN' }, "From the file list, click holding {key} to show")
            )
        )
    })
}

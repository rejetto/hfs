import { DirEntry, ext2type, state, useSnapState } from './state'
import { createElement as h, Fragment, useEffect, useRef, useState } from 'react'
import { domOn, hfsEvent, hIcon, newDialog, restartAnimation } from './misc'
import { useEventListener, useWindowSize } from 'usehooks-ts'
import { EntryDetails, useMidnight } from './BrowseFiles'
import { Btn, Flex, FlexV, iconBtn, Spinner } from './components'
import { openFileMenu } from './fileMenu'
import { t, useI18N } from './i18n'
import { alertDialog } from './dialog'
import _ from 'lodash'

enum ZoomMode {
    fullWidth,
    freeY,
    contain, // leave this as last
}

export function fileShow(entry: DirEntry) {
    const { close } = newDialog({
        noFrame: true,
        className: 'file-show',
        Content() {
            const [cur, setCur] = useState(entry)
            const moving = useRef(0)
            const lastGood = useRef(entry)
            const [mode, setMode] = useState(ZoomMode.contain)
            useEventListener('keydown', ({ key }) => {
                if (key === 'ArrowLeft')
                    return goPrev()
                if (key === 'ArrowRight')
                    return goNext()
                if (key === 'ArrowDown')
                    return scrollY(1)
                if (key === 'ArrowUp')
                    return scrollY(-1)
                if (key === 'd')
                    return location.href = cur.uri + '?dl'
                if (key === 'z')
                    return switchZoomMode()
                if (key === 'f')
                    return toggleFullScreen()
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
            const timerRef = useRef(0)
            const navClass = 'nav' + (showNav ? '' : ' nav-hidden')

            const [loading, setLoading] = useState(false)
            const [failed, setFailed] = useState<false | string>(false)
            const containerRef = useRef<HTMLDivElement>()
            const mainRef = useRef<HTMLDivElement>()
            useEffect(() => { scrollY(-1E9) }, [cur])

            const { auto_play_seconds } = useSnapState()
            const [autoPlaying, setAutoPlaying] = useState(false)
            const showElement = containerRef.current?.querySelector('*')
            useEffect(() => {
                if (!autoPlaying || !showElement) return
                if (showElement instanceof HTMLMediaElement) {
                    showElement.play().catch(curFailed)
                    return domOn('ended', goNext, { target: showElement as any })
                }
                // we are supposedly showing an image
                const h = setTimeout(() => go(+1), state.auto_play_seconds * 1000)
                return () => clearTimeout(h)
            }, [showElement, autoPlaying, cur])
            const {mediaSession} = navigator
            mediaSession.setActionHandler('nexttrack', goNext)
            mediaSession.setActionHandler('previoustrack', goPrev)

            const {t} = useI18N()
            return h(FlexV, {
                gap: 0,
                alignItems: 'stretch',
                className: ZoomMode[mode],
                props: {
                    role: 'dialog',
                    onMouseMove() {
                        setShowNav(true)
                        clearTimeout(timerRef.current)
                        timerRef.current = +setTimeout(() => setShowNav(false), 1_000)
                    }
                }
            },
                h('div', { className: 'bar' },
                    h('div', { className: 'filename' }, cur.n),
                    h(EntryDetails, { entry: cur, midnight: useMidnight() }),
                    h(Flex, {},
                        useWindowSize().width > 1280 && iconBtn('?', showHelp),
                        h('div', {}, // fuse buttons
                            h(Btn, {
                                className: 'small',
                                label: t`Auto-play`,
                                toggled: autoPlaying,
                                onClick: () => setAutoPlaying(x => !x),
                            }),
                            autoPlaying && h(Btn, {
                                className: 'small',
                                label: String(auto_play_seconds),
                                onClick: configAutoPlay,
                            }),
                        ),
                        iconBtn('menu', ev => openFileMenu(cur, ev, [
                            'open','delete',
                            { id: 'zoom', icon: 'zoom', label: t`Switch zoom mode`, onClick: switchZoomMode },
                            { id: 'fullscreen', icon: 'fullscreen', label: t`Full screen`, onClick: toggleFullScreen },
                        ])),
                        iconBtn('close', close),
                    )
                ),
                h(FlexV, { center: true, alignItems: 'center', className: 'main', ref: mainRef },
                    loading && h(Spinner, { style: { position: 'absolute', fontSize: '20vh', opacity: .5 } }),
                    failed === cur.n ? h(FlexV, { alignItems: 'center', textAlign: 'center' },
                        hIcon('error', { style: { fontSize: '20vh' } }),
                        h('div', {}, cur.name),
                        t`Loading failed`
                    ) : h('div', { className: 'showing-container', ref: containerRef },
                        h(getShowType(cur) || Fragment, {
                            src: cur.uri,
                            className: 'showing',
                            onLoad() {
                                lastGood.current = cur
                                setLoading(false)
                            },
                            onError: curFailed
                        })
                    ),
                    hIcon('❮', { className: navClass, style: { left: 0 }, onClick: goPrev }),
                    hIcon('❯', { className: navClass, style: { right: 0 }, onClick: goNext }),
                ),
            )

            function goPrev() { go(-1) }

            function goNext() { go(+1) }

            function curFailed() {
                if (cur !== lastGood.current)
                    return go()
                setLoading(false)
                setFailed(cur.n)
            }

            function go(dir?: number) {
                if (dir)
                    moving.current = dir
                let e = cur
                setFailed(false)
                setLoading(true)
                while (1) {
                    e = e.getSibling(moving.current)
                    if (!e) { // reached last
                        if (dir! > 0) setAutoPlaying(false)
                        setLoading(cur !== lastGood.current)
                        setCur(lastGood.current) // revert to last known supported file
                        return restartAnimation(document.body, '.2s blink')
                    }
                    if (!e.isFolder && getShowType(e)) break // give it a chance
                }
                setCur(e)
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

            function scrollY(dy: number) {
                containerRef.current?.scrollBy(0, dy * .5 * containerRef.current?.clientHeight)
            }

            function configAutoPlay() {
                newDialog({
                    title: t`Auto-play`,
                    Content() {
                        const { auto_play_seconds } = useSnapState()
                        return h(FlexV, {},
                            t('autoplay_seconds', "Seconds to wait on images"),
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
}

export function getShowType(entry: DirEntry) {
    const res = hfsEvent('fileShow', { entry }).find(Boolean)
    if (res)
        return res
    const type = ext2type(entry.ext)
    return type === 'audio' ? Audio
        : type === 'video' ? Video
        : type === 'image' ? 'img'
        : ''
}

function Audio({ onLoad, ...rest }: any) {
    return h('audio', { onLoadedData: onLoad, controls: true, ...rest })
}

function Video({ onLoad, ...rest }: any) {
    return h('video', { onLoadedData: onLoad, controls: true, ...rest })
}

function showHelp() {
    newDialog({
        title: t`File Show help`,
        className: 'file-show-help',
        Content: () => h(Fragment, {},
            t('showHelpMain', {}, "You can use the keyboard for some actions:"),
            _.map({
                "←/→": "go to previous/next file",
                "↑/↓": "scroll tall images",
                "space": "select",
                "D": "download",
                "Z": "zoom modes",
                "F": "full screen",
            }, (v,k) => h('div', { key: k }, h('kbd', {}, t('showHelp_' + k, {}, k)), ' ', t('showHelp_' + k + '_body', {}, v)) )
        )
    })
}

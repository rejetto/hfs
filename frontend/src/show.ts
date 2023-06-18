import { DirEntry, ext2type, state } from './state'
import { createElement as h, Fragment, useRef, useState } from 'react'
import { hfsEvent, hIcon, newDialog, restartAnimation, WIKI_URL } from './misc'
import { useEventListener, useWindowSize } from 'usehooks-ts'
import { EntryDetails, useMidnight } from './BrowseFiles'
import { Flex, FlexV, iconBtn } from './components'
import { openFileMenu } from './fileMenu'
import { useI18N } from './i18n'

export function fileShow(entry: DirEntry) {
    const close = newDialog({
        noFrame: true,
        className: 'file-show',
        Content() {
            const [cur, setCur] = useState(entry)
            const moving = useRef(0)
            const lastGood = useRef(entry)
            useEventListener('keydown', ({ key }) => {
                if (key === 'ArrowLeft')
                    return go(-1)
                if (key === 'ArrowRight')
                    return go(+1)
                if (key === 'ArrowDown')
                    return location.href = cur.uri + '?dl'
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
            const [failed, setFailed] = useState<false | string>(false)
            const {t} = useI18N()
            return h(Fragment, {},
                h(FlexV, { gap: 0, alignItems: 'stretch' },
                    h('div', { className: 'bar' },
                        h('div', { className: 'filename' }, cur.n),
                        h(EntryDetails, { entry, midnight: useMidnight() }),
                        h(Flex, {},
                            useWindowSize().width > 1280 && iconBtn('?', () => window.open(WIKI_URL + 'File-show')),
                            iconBtn('menu', ev => openFileMenu(cur, ev, ['open','delete'])),
                            iconBtn('close', close),
                        )
                    ),
                    h(FlexV, { flex: 1, center: true, position: 'relative', maxHeight: '100%',
                        overflow: 'hidden' // without this <video> can make me go beyond the screen limit
                    },
                        failed === cur.n ? h(FlexV, { alignItems: 'center', textAlign: 'center' },
                            hIcon('error', { style: { fontSize: '20vh' } }),
                            h('div', {}, cur.name),
                            t`Loading failed`
                        ) : h(getShowType(cur) || Fragment, {
                            src: cur.uri,
                            className: 'showing',
                            onLoad: () => lastGood.current = cur,
                            onError: () => {
                                go()
                                setFailed(cur.n)
                            }
                        }),
                        hIcon('❮', { className: 'nav', style: { left: 0 }, onClick: () => go(-1) }),
                        hIcon('❯', { className: 'nav', style: { right: 0 }, onClick: () => go(+1) }),
                    ),
                )
            )

            function go(dir?: number) {
                if (dir)
                    moving.current = dir
                let e = cur
                setFailed(false)
                while (1) {
                    e = e.getSibling(moving.current)
                    if (!e) { // reached last
                        setCur(lastGood.current) // revert to last known supported file
                        return restartAnimation(document.body, '.2s blink')
                    }
                    if (!e.isFolder && getShowType(e)) break // give it a chance
                }
                setCur(e)
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
import { createElement as h, useEffect, useMemo, useState } from 'react'
import { Box, Card, CardActions, CardContent } from '@mui/material'
import { Btn } from './mui'
import { state, useSnapState } from './state'
import { useApiList } from './api'
import { DAY, tryJson, wantArray } from './misc'
import _ from 'lodash'
import { renderName } from './InstalledPlugins'
import { installPluginFromResult } from './OnlinePlugins'
import { toast } from './dialog'

const cacheKey = 'onlinePluginsCache'

export function RandomPlugin() {
    const { hideRandomPlugin } = useSnapState()
    const serializedCache = localStorage.getItem(cacheKey)
    const cached = useMemo(() => {
        const obj = tryJson(serializedCache || '')
        return obj?.ts && Date.now() - obj.ts < DAY  && _.shuffle(obj.list)
    }, [serializedCache])
    const { list, initializing } = useApiList(!hideRandomPlugin && !cached && 'get_online_plugins')
    const [idx, setIdx] = useState(-1)
    const one = cached?.[idx]
    useEffect(() => {
        if (!cached && !initializing && list.length)
            localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), list }))
        setIdx(0)
    }, [list, initializing])
    useEffect(() => {
        if (idx > 0 && !one)
            toast("No more plugins!")
    }, [idx])
    if (hideRandomPlugin || !one) return
    return h(Card, { sx: { display: { xs: 'none', md: 'block' }, float: 'right', width: 'min(50%, 30em)', ml: '1em' } },
        h(CardContent, {},
            h(Box, { fontWeight: 'bold', fontSize: '1.4em' }, h(Box, { color: 'warning.main', mr: 1, display: 'inline' }, '★'), "Random plugin:"),
            h(Box, { fontWeight: 'bold', fontSize: '1.8em', my: 1 }, renderName({ row: one })),
            h(Box, {}, one.description),
            one.preview && h('img', {
                src: wantArray(one.preview)[0],
                style: {
                    maxWidth: '100%',
                    maxHeight: '50vh',
                    marginTop: '1em',
                    border: '1px solid',
                    maskImage: 'radial-gradient(circle at center, black 50%, transparent 100%)'
                }
            }),
        ),
        h(CardActions, {},
            h(Btn, { variant: 'outlined', onClick: () => installPluginFromResult(one) }, "Install"),
            h(Btn, { variant: 'outlined', onClick: () => setIdx(x => x + 1) }, "Another"),
            h(Btn, { variant: 'outlined', onClick() { state.hideRandomPlugin = true } }, "Hide this box"),
        )
    )
}
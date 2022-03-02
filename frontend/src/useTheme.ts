// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { useEffect } from 'react'

export default function() {
    const { theme } = useSnapState()
    useEffect(()=>{
        const e = document.body
        if (!e) return
        const t = state.theme
        const pre = 'theme-'
        const ct = pre+t
        const list = e.classList
        for (const c of Array.from(list))
            if (c.startsWith(pre) && c !== ct)
                list.remove(c)
        if (t)
            list.add(ct)
    }, [theme])
}

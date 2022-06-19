// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useSnapState } from './state'
import { useEffect } from 'react'
import { useMediaQuery } from '@mui/material'

export default function useTheme() {
    const { theme } = useSnapState()
    const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
    useEffect(()=>{
        const e = document.body
        if (!e) return
        const name = theme || (systemDark ? 'dark' : 'light')
        const pre = 'theme-'
        const ct = pre + name
        const list = e.classList
        console.debug({ theme, name, dark: systemDark })
        for (const c of Array.from(list))
            if (c.startsWith(pre) && c !== ct)
                list.remove(c)
        if (name)
            list.add(ct)
    }, [theme, systemDark])
}

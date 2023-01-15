// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { useSnapState } from './state'
import { useEffect } from 'react'
import { useMediaQuery } from 'usehooks-ts'

export default function useTheme() {
    const { theme } = useSnapState()
    const isDarkMode = useMediaQuery('(prefers-color-scheme: dark)') // don't use useDarkMode() as it persists in localstorage and there's no way to just read system setting
    useEffect(()=>{
        const e = document.body
        if (!e) return
        const name = theme || (isDarkMode ? 'dark' : 'light')
        const pre = 'theme-'
        const ct = pre + name
        const list = e.classList
        for (const c of Array.from(list))
            if (c.startsWith(pre) && c !== ct)
                list.remove(c)
        if (name)
            list.add(ct)
    }, [theme, isDarkMode])
}

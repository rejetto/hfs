import { useCallback, useEffect, useRef, useState } from 'react'
import { waitFor } from './misc'

export function useIsMounted() {
    const ref = useRef(true)

    useEffect(() => () => {
        ref.current = false
    }, [])

    return useCallback(()=> ref.current, [ref])
}

export function useStateMounted(init?: any) {
    const isMounted = useIsMounted()
    const [v,set] = useState(init)
    const setIfMounted = useCallback(x => {
        if (isMounted())
            set(x)
    }, [isMounted,set])
    return [v, setIfMounted, isMounted]
}

export const ICON_FONT_NAME = waitFor(()=> document.getElementById('iconsFile')).then(el => decodeURIComponent((el as HTMLLinkElement).href.split('=')[1].replace(/\+/g, ' ')))
const iconsReady = document.fonts.ready.then(()=> ICON_FONT_NAME).then(name => document.fonts.load(`9px "${name}"`))

export function usePromise<T>(p:Promise<T>): T | undefined {
    const [v, setV] = useStateMounted()
    useEffect(()=>{
        p.then(setV)
    }, [])
    return v
}

export function useIconsReady() {
    return usePromise(iconsReady)
}

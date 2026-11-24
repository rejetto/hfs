import { useEffect } from 'react'
import { useHashLocation } from 'wouter/use-hash-location'
import { removeStarting } from './misc'

export function useRoutedTab(basePath: string, tabPaths: readonly string[]) {
    // compare the original hash so escaped plugin ids remain distinct
    const [pathname, navigate] = useHashLocation()
    const prefix = `/${basePath}/`
    const tab = Math.max(0, tabPaths.indexOf(removeStarting(prefix, pathname)))
    const wanted = prefix + tabPaths[tab]

    useEffect(() => {
        // replace bare/unknown tab URLs so refresh and history stay aligned with the visible tab
        if (pathname !== wanted)
            navigate(wanted, { replace: true })
    }, [navigate, pathname, wanted])

    return [tab, setTab] as const

    function setTab(i: number) {
        navigate(prefix + tabPaths[i])
    }
}

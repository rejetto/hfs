import { useEffect } from 'react'
import { useLocation } from 'wouter'
import { removeStarting } from './misc'

export function useRoutedTab(basePath: string, tabPaths: readonly string[]) {
    const [pathname, navigate] = useLocation()
    const prefix = `/${basePath}/`
    const tab = Math.max(0, tabPaths.indexOf(removeStarting(prefix, pathname)))

    useEffect(() => {
        const wanted = `/${basePath}/${tabPaths[tab]}`
        // replace bare/unknown tab URLs so refresh and history stay aligned with the visible tab
        if (pathname !== wanted)
            navigate(wanted, { replace: true })
    }, [basePath, navigate, pathname, tab, tabPaths])

    return [tab, setTab] as const

    function setTab(i: number) {
        navigate(`/${basePath}/${tabPaths[i]}`)
    }
}

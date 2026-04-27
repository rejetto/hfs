import { Children, cloneElement, createElement as h, forwardRef, isValidElement, useEffect } from 'react'
import type { AnchorHTMLAttributes, ComponentType, ReactElement, ReactNode } from 'react'
import { Link as WouterLink, Route as WouterRoute, Router, Switch, useLocation as useWouterLocation } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    to: string
}

type RouteProps = {
    path?: string
    element?: ReactElement
    children?: ReactNode
    component?: ComponentType<any>
}

export function Routes({ children }: { children?: ReactNode }) {
    // In wouter, empty string paths are interpreted like missing paths and become wildcards in Switch matching.
    const normalizedChildren = Children.map(children, normalizeChildRoutePath)
    return h(Switch as unknown as ComponentType<any>, {}, normalizedChildren)
}

// We keep hash navigation because admin routes are currently deep-linked with # fragments.
export function HashRouter({ children }: { children?: ReactNode }) {
    // We pass children in props to satisfy Router's strict typing in this project setup.
    return h(Router, { hook: useHashLocation, children })
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
    // MUI passes refs to custom link components; forwarding it keeps ButtonBase/Link behavior working.
    // MUI may inject an `href` prop; keep our normalized target authoritative for hash routing consistency.
    return h(WouterLink as unknown as ComponentType<any>, { ...rest, ref, href: normalizePath(to) })
})

export function useNavigate() {
    const [, setLocation] = useWouterLocation()
    return (to: string, options?: { replace?: boolean }) => {
        setLocation(normalizePath(to), options)
    }
}

export function useLocation(): { pathname: string } {
    const [pathname] = useWouterLocation()
    return { pathname }
}

export function Route({ path, element, children, component, ...rest }: RouteProps) {
    const routePath = path === '*' ? '/:rest*' : normalizePath(path)
    if (element)
        return h(WouterRoute, { path: routePath, ...rest }, element)
    if (component)
        return h(WouterRoute, { path: routePath, component, ...rest })
    return h(WouterRoute, { path: routePath, ...rest }, children)
}

function normalizePath(path: string | undefined) {
    if (!path || path === '#')
        return '/'
    return path.startsWith('/') ? path : `/${path}`
}

function normalizeChildRoutePath(child: ReactNode) {
    if (!isValidElement(child))
        return child
    if (!('path' in child.props))
        return child
    if (child.props.path !== '')
        return child
    return cloneElement(child, { path: '/' })
}

export function useRoutedTab(basePath: string, tabPaths: readonly string[]) {
    const { pathname } = useLocation()
    const navigate = useNavigate()
    const prefix = `/${basePath}/`
    const pathTab = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
    const pathTabIndex = tabPaths.indexOf(pathTab)
    const tab = pathTabIndex < 0 ? 0 : pathTabIndex

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

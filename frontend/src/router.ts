import { createElement as h, Fragment } from 'react'
import { Link as WouterLink, Route as WouterRoute, Switch, useLocation as useWouterLocation } from 'wouter'
import type { AnchorHTMLAttributes, ComponentType, ReactElement, ReactNode } from 'react'

// this module is designed to offer a minimal compatibility interface as that of react-router-dom

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    to: string
    reloadDocument?: boolean
}

export const Routes = Switch as unknown as ComponentType<any>
export const BrowserRouter = Fragment

export function Link({ to, reloadDocument, ...rest }: LinkProps) {
    if (reloadDocument)
        return h('a', { href: to, ...rest })
    return h(WouterLink as unknown as ComponentType<any>, { href: to, ...rest })
}

export function useNavigate() {
    const [, setLocation] = useWouterLocation()
    return (to: string, options?: { replace?: boolean }) => {
        setLocation(to, options)
    }
}

export function useLocation(): { pathname: string } {
    const [pathname] = useWouterLocation()
    return { pathname }
}

type RouteProps = {
    path?: string
    element?: ReactElement
    children?: ReactNode
    component?: ComponentType<any>
}

export function Route({ path, element, children, component, ...rest }: RouteProps) {
    const resolvedPath = path === '*' ? '/:rest*' : path
    if (element)
        return h(WouterRoute, { path: resolvedPath, ...rest }, element)
    if (component)
        return h(WouterRoute, { path: resolvedPath, component, ...rest })
    return h(WouterRoute, { path: resolvedPath, ...rest }, children)
}

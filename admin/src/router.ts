import { Children, cloneElement, createElement as h, forwardRef, Fragment, isValidElement } from 'react'
import type { AnchorHTMLAttributes, ComponentType, CSSProperties, ReactElement, ReactNode } from 'react'
import { Link as WouterLink, Route as WouterRoute, Router, Switch, useLocation as useWouterLocation } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    to: string
}

type NavLinkRenderProps = {
    isActive: boolean
}

type NavLinkProps = Omit<LinkProps, 'children' | 'className' | 'style'> & {
    children?: ReactNode | ((props: NavLinkRenderProps) => ReactNode)
    className?: string | ((props: NavLinkRenderProps) => string | undefined)
    end?: boolean
    style?: CSSProperties | ((props: NavLinkRenderProps) => CSSProperties | undefined)
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

export const NavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(function NavLink({ to, end, className, style, children, ...rest }, ref) {
    const [pathname] = useWouterLocation()
    const targetPath = normalizePath(to)
    const isActive = end
        ? pathname === targetPath
        : targetPath === '/'
            ? pathname === '/'
            : pathname === targetPath || pathname.startsWith(`${targetPath}/`)
    const activeProps = { isActive }
    return h(Link, {
        ref,
        to: targetPath,
        ...rest,
        className: typeof className === 'function' ? className(activeProps) : className,
        style: typeof style === 'function' ? style(activeProps) : style,
        children: typeof children === 'function' ? children(activeProps) : children,
    })
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

export const BrowserRouter = Fragment

function normalizeChildRoutePath(child: ReactNode) {
    if (!isValidElement(child))
        return child
    if (!('path' in child.props))
        return child
    if (child.props.path !== '')
        return child
    return cloneElement(child, { path: '/' })
}

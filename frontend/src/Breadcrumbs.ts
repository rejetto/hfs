import { Link, useLocation } from 'react-router-dom'
import { createElement as h, Fragment, useContext } from 'react'
import { ListContext } from './BrowseFiles'
import { confirmDialog } from './dialog'
import { hIcon } from './misc'

export function Breadcrumbs() {
    const currentPath = useLocation().pathname.slice(1,-1)
    let prev = ''
    const breadcrumbs = currentPath ? currentPath.split('/').map(x => [prev = prev + x + '/', decodeURIComponent(x)]) : []
    return h(Fragment, {},
        h(Breadcrumb),
        breadcrumbs.map(([path,label]) =>
            h(Breadcrumb, {
                key: path,
                path,
                label,
                current: path === currentPath+'/',
            }) )
    )
}

function Breadcrumb({ path, label, current }:{ current: boolean, path?: string, label?: string }) {
    const PAD = '\u00A0' // make small elements easier to tap. Don't use min-width 'cause it requires display-inline that breaks word-wrapping
    if (label && label.length < 3)
        label = PAD+label+PAD
    const { reload } = useContext(ListContext)
    return h(Link, {
        className: 'breadcrumb',
        to: path || '/',
        async onClick() {
            if (current && await confirmDialog('Reload?'))
                reload?.()
        }
    }, label || hIcon('home') )
}


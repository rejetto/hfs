import { createElement as h } from 'react'
import { ICON_FONT_NAME, useIconsReady, usePromise } from './hooks'

const SYS_ICONS: Record<string,string> = {
    login: 'person',
    user: 'account_circle',
    file: 'description',
    spinner: 'sports_baseball',
}

const iconClass = ICON_FONT_NAME.then(v => v.replace(/ /g,'-').toLowerCase())
export function Icon({ name, forced, ...props }: { name:string, forced?:boolean, style?:any }) {
    name = SYS_ICONS[name] || name
    const cl = usePromise(iconClass)
    return h('span',{
        className: cl+' icon',
        ...props
    }, useIconsReady() || forced ? name : '')
}

export function Loading() {
    return useIconsReady() ? h(Spinner)
        : h('span', {}, 'Loading...')
}

export function Spinner() {
    return h(Icon, { name:'spinner', style: { animation:'1s spin infinite' } })
}


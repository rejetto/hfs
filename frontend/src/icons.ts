import { state, useSnapState } from './state'
import { createElement as h } from 'react'

const SYS_ICONS: Record<string,string> = {
    login: 'person',
    user: 'account_circle',
    file: 'description',
    spinner: 'sports_baseball',
    filter: 'filter_alt',
    interrupted: 'heart_broken',
    sort: 'sort_by_alpha',
}

document.fonts.ready.then(async ()=> {
    const fontName = 'icons'
    await document.fonts.load(`9px "${fontName}"`) // force font to be loaded even if we didn't display anything with it yet
    state.iconsClass = ' ' // don't need additional class, but the empty space will cause reload
})

export function Icon({ name, className='', ...props }: { name:string, className:string, style?:any }) {
    name = SYS_ICONS[name] || name
    const { iconsClass } = useSnapState()
    return h('span',{
        ...props,
        className: iconsClass+' icon '+className,
    }, iconsClass ? name : '#')
}


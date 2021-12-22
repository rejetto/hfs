import { state, useSnapState } from './state'
import { createElement as h } from 'react'
import { waitFor } from './misc'

const SYS_ICONS: Record<string,string> = {
    login: 'person',
    user: 'account_circle',
    file: 'description',
    spinner: 'sports_baseball',
    filter: 'filter_alt',
    interrupted: 'heart_broken',
}

document.fonts.ready.then(async ()=> {
    const el = await waitFor(()=> document.getElementById('iconsFile'))
    const name = decodeURIComponent((el as HTMLLinkElement).href.split('=')[1].replace(/\+/g, ' '))
    await document.fonts.load(`9px "${name}"`) // force font to be loaded even if we didn't display anything with it yet
    state.iconsClass = name.replace(/ /g,'-').toLowerCase()
})

export function Icon({ name, className, ...props }: { name:string, className?:string, style?:any }) {
    name = SYS_ICONS[name] || name
    const { iconsClass } = useSnapState()
    return h('span',{
        ...props,
        className: iconsClass+' icon '+className,
    }, iconsClass ? name : '#')
}


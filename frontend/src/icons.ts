import { state, useSnapState } from './state'
import { createElement as h } from 'react'

const SYS_ICONS: Record<string,string> = {
    login: 'user-o',
    user: 'user-o',
    file: 'doc',
    spinner: 'spin6 spinner',
    settings: 'cog',
    parent: 'level-up mirror',
    archive: 'file-archive',
    interrupted: 'unlink',
}

document.fonts.ready.then(async ()=> {
    const fontName = 'fontello'
    await document.fonts.load(`9px "${fontName}"`) // force font to be loaded even if we didn't display anything with it yet
    state.iconsClass = ' ' // don't need additional class, but the empty space will cause reload
})

export function Icon({ name, className='', ...props }: { name:string, className:string, style?:any }) {
    name = SYS_ICONS[name] || name
    const { iconsClass } = useSnapState()
    return h('i',{
        ...props,
        className: iconsClass && 'icon fa-'+name,
    }, iconsClass ? null : '#')
}


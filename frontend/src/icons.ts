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
    password: 'key',
}
const ICON2EMOJI = {
    login: '👤',
    user: '👤',
    filter: '✂',
    search: '🔍',
    settings: '⚙',
    archive: '📦',
    logout: '🚪',
    home: '🏠',
    parent: '⬆️',
    folder: '📂',
    file: '📄',
    spinner: '🎲',
    password: '🗝️',
    download: '📥'
}

document.fonts.ready.then(async ()=> {
    const fontName = 'fontello'
    await document.fonts.load(`9px "${fontName}"`) // force font to be loaded even if we didn't display anything with it yet
    state.iconsClass = ' ' // with fontello we don't need an additional class (unlike google material icons), but the empty space will cause reload
})

export function Icon({ name, className='', ...props }: { name:string, className:string, style?:any }) {
    // @ts-ignore
    const emoji = ICON2EMOJI[name] || '#'
    name = SYS_ICONS[name] || name
    const { iconsClass } = useSnapState()
    return h('span',{
        ...props,
        className: className+' icon '+(iconsClass ? 'fa-'+name : 'emoji'),
    }, iconsClass ? null : emoji)
}


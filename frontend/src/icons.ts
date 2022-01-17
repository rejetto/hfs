import { state, useSnapState } from './state'
import { createElement as h } from 'react'

const SYS_ICONS = {
    login: 'user:👤',
    user: 'user:👤',
    filter: ':✂',
    search: ':🔍',
    search_off: 'cancel:❌',
    stop: ':⏹️',
    settings: 'cog:⚙',
    archive: 'file-archive:📦',
    logout: ':🚪',
    home: ':🏠',
    parent: 'level-up mirror️:⬆',
    folder: ':📂',
    file: 'doc:📄',
    spinner: 'spin6 spinner:🎲',
    password: 'key:🗝️',
    download: ':📥',
}

document.fonts.ready.then(async ()=> {
    const fontName = 'fontello'
    await document.fonts.load(`9px "${fontName}"`) // force font to be loaded even if we didn't display anything with it yet
    state.iconsClass = ' ' // with fontello we don't need an additional class (unlike google material icons), but the empty space will cause reload
})

export function Icon({ name, className='', ...props }: { name:string, className:string, style?:any }) {
    // @ts-ignore
    const [clazz,emoji] = (SYS_ICONS[name] || name).split(':')
    const { iconsClass } = useSnapState()
    return h('span',{
        ...props,
        className: className+' icon '+(iconsClass ? 'fa-'+(clazz||name) : 'emoji'),
    }, iconsClass ? null : (emoji||'#'))
}


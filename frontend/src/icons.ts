// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, memo } from 'react'

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
    parent: 'level-up mirror:⬆',
    folder: ':📂',
    file: 'doc:📄',
    spinner: 'spin6 spinner:🎲',
    password: 'key:🗝️',
    download: ':📥',
    invert: 'retweet:🙃',
    admin: 'crown:👑',
    check: ':✔️',
}

document.fonts.ready.then(async ()=> {
    const fontTester = '9px "fontello"'
    await document.fonts.load(fontTester) // force font to be loaded even if we didn't display anything with it yet
    if (document.fonts.check(fontTester))
        state.iconsClass = ' ' // with fontello we don't need an additional class (unlike google material icons), but the empty space will cause reload
})

export const Icon = memo(({ name, alt, className='', ...props }: { name:string, className?:string, alt?:string, style?:any }) => {
    // @ts-ignore
    const [clazz,emoji] = (SYS_ICONS[name] || name).split(':')
    const { iconsClass } = useSnapState()
    className += ' icon ' + (iconsClass ? 'fa-'+(clazz||name) : 'emoji')
    return h('span',{
        ...props,
        'aria-label': alt,
        role: 'img',
        className,
    }, iconsClass ? null : (emoji||'#'))
})

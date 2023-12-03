// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, memo } from 'react'

const SYS_ICONS: Record<string, [string] | [string, string | false]> = { // false means we don't have the icon, only unicode
    login: ['👤','user'],
    user: ['👤','user'],
    filter: ['✂'],
    search: ['🔍'],
    search_off: ['❌','cancel'],
    close: ['❌','cancel'],
    error: ['❌','cancel'],
    stop: ['⏹️'],
    settings: ['⚙','cog'],
    archive: ['📦'],
    logout: ['🚪'],
    home: ['🏠'],
    parent: ['⬅','left'],
    folder: ['📂'],
    file: ['📄','doc'],
    spinner: ['🎲','spin6 spinner'],
    password: ['🗝️','key'],
    download: ['⬇️'],
    upload: ['⬆️'],
    reload: ['🔄','reload'],
    lock: ['🔒','lock'],
    admin: ['👑','crown'],
    check: ['✔️'],
    to_start: ['◀'],
    to_end: ['▶'],
    menu: ['☰'],
    list: ['☰','menu'],
    play: ['▶'],
    pause: ['⏸'],
    edit: ['✏️'],
    zoom: ['↔'],
    delete: ['🗑️', 'trash'],
    comment: ['💬'],
    link: ['↗'],
    info: ['ⓘ', false],
    cut: ['✄'],
    paste: ['📋'],
}

document.fonts.ready.then(async ()=> {
    const fontTester = '9px fontello'
    await document.fonts.load(fontTester) // force font to be loaded even if we didn't display anything with it yet
    state.iconsReady = document.fonts.check(fontTester)
})

interface IconProps { name:string, className?:string, alt?:string, [rest:string]: any }
export const Icon = memo(({ name, alt, className='', ...props }: IconProps) => {
    if (!name) return null
    const [emoji, clazz=name] = SYS_ICONS[name] || []
    const { iconsReady } = useSnapState()
    className += ' icon'
    const nameIsTheIcon = name.length === 1 ||
        name.match(/^[\uD800-\uDFFF\u2600-\u27BF\u2B50-\u2BFF\u3030-\u303F\u3297\u3299\u00A9\u00AE\u200D\u20E3\uFE0F\u2190-\u21FF\u2300-\u23FF\u2400-\u243F\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF]*$/)
    const nameIsFile = !nameIsTheIcon && name.includes('.')
    const isFontIcon = iconsReady && clazz
    className += nameIsFile ? ' file-icon' : isFontIcon ? ` fa-${clazz}` : ' emoji-icon'
    return h('span',{
        'aria-label': alt,
        role: 'img',
        ...props,
        ...nameIsFile ? { style: { backgroundImage: `url(${JSON.stringify(name)})`, ...props?.style } } : undefined,
        className,
    }, nameIsTheIcon ? name : isFontIcon ? null : (emoji||'#'))
})

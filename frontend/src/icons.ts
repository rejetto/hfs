// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, memo } from 'react'

const SYS_ICONS = {
    login: '👤:user',
    user: '👤:user',
    filter: '✂',
    search: '🔍',
    search_off: '❌:cancel',
    stop: '⏹️',
    settings: '⚙:cog',
    archive: '📦',
    logout: '🚪',
    home: '🏠',
    parent: '⬅:level-up mirror',
    folder: '📂',
    file: '📄:doc',
    spinner: '🎲:spin6 spinner',
    password: '🗝️:key',
    download: '⬇️',
    upload: '⬆️',
    invert: '🙃:retweet',
    admin: '👑:crown',
    check: '✔️',
    to_start: '◀',
    to_end: '▶',
}

document.fonts.ready.then(async ()=> {
    const fontTester = '9px "fontello"'
    await document.fonts.load(fontTester) // force font to be loaded even if we didn't display anything with it yet
    if (document.fonts.check(fontTester))
        state.iconsClass = ' ' // with fontello we don't need an additional class (unlike google material icons), but the empty space will cause reload
})

interface IconProps { name:string, className?:string, alt?:string, [rest:string]: any }
export const Icon = memo(({ name, alt, className='', ...props }: IconProps) => {
    const [emoji,clazz] = ((SYS_ICONS as any)[name] || name).split(':')
    const { iconsClass } = useSnapState()
    className += ' icon'
    const nameIsEmoji = name.length <= 2
    const nameIsFile = name.includes('.')
    className += nameIsEmoji ? ' emoji-icon' : nameIsFile ? ' file-icon' : iconsClass ? ' fa-'+(clazz||name) : ' emoji'
    return h('span',{
        'aria-label': alt,
        role: 'img',
        ...props,
        ...nameIsFile ? { style: { backgroundImage: `url(${JSON.stringify(name)})`, ...props?.style } } : undefined,
        className,
    }, nameIsEmoji ? name : iconsClass ? null : (emoji||'#'))
})

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { state, useSnapState } from './state'
import { createElement as h, memo } from 'react'
import { SYS_ICONS } from './sysIcons'
import { getHFS } from '@hfs/shared'

const documentComplete = document.readyState === 'complete' ? Promise.resolve()
    : new Promise(res => document.addEventListener('readystatechange', res))
// fonts.ready seems to be unreliable with iphone + additional <script> in custom-html + plugins using frontend_js, but still can be interesting if it resolves faster the document.complete, as we specifically interested in the fonts
Promise.race([documentComplete, document.fonts?.ready]).then(async () => {
    if (!document.fonts)
        return state.iconsReady = true
    const fontTester = '9px fontello'
    await document.fonts.load(fontTester) // force font to be loaded even if we didn't display anything with it yet
    state.iconsReady = document.fonts.check(fontTester)
})

export interface IconProps { name:string, className?:string, alt?:string, [rest:string]: any }
// name = null ? none : unicode ? unicode : "?" ? file_url : font_icon_class
export const Icon = memo(({ name, alt, className='', ...props }: IconProps) => {
    if (!name) return null
    name = getHFS().icons?.[name] ?? name
    const [emoji, clazz=name] = SYS_ICONS[name] || []
    const { iconsReady } = useSnapState()
    className += ' icon'
    const nameIsTheIcon = name.length === 1 ||
        name.match(/^[\uD800-\uDFFF\u2600-\u27BF\u2B00-\u2BFF\u3030-\u303F\u3297\u3299\u00A9\u00AE\u200D\u20E3\uFE0F\u2190-\u21FF\u2300-\u23FF\u2400-\u243F\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF]*$/)
    const nameIsUrl = !nameIsTheIcon && /[/?]/.test(name)
    const isFontIcon = iconsReady && clazz
    className += nameIsUrl ? ' file-icon' : isFontIcon ? ` font-icon fa-${clazz}` : ' emoji-icon'
    return h('span',{
        ...alt ? { 'aria-label': alt } : { 'aria-hidden': true },
        role: 'img',
        ...props,
        ...nameIsUrl ? { style: { backgroundImage: `url(${JSON.stringify(name)})`, ...props?.style } } : undefined,
        className,
    }, nameIsTheIcon ? name : isFontIcon ? null : (emoji||'#'))
})

// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, HTMLAttributes, ReactNode, useMemo } from 'react'

export const MD_TAGS = {
    a: 'a',
    '`': 'code',
    '*': 'i',
    '**': 'b',
}
type OnText = (s: string) => ReactNode
// md-inspired formatting, very simplified
export function md(text: string | TemplateStringsArray, { html=true, linkTarget='_blank', onText=(x=>x) as OnText }={}) {
    if (typeof text !== 'string')
        text = text[0]
    return replaceStringToReact(text, /(`|_|\*\*?)(.+?)\1|(\n)|\[(.+?)\]\((.+?)\)|(<(\w+?)(?:\s+[^>]*?)?>(?:.*?<\/\7>)?)/g, m =>
        m[4] ? h(MD_TAGS.a, { href: m[5], target: linkTarget }, onText(m[4]))
            : m[3] ? h('br')
            : m[1] ? h((MD_TAGS as any)[ m[1] ] || Fragment, {}, onText(m[2]))
            : html ? h(Html, {}, m[6]) : m[6],
        onText)
}

export function replaceStringToReact(text: string, re: RegExp, cb: (match: RegExpExecArray) => ReactNode, onText=(x=>x) as OnText ) {
    const res = []
    let last = 0
    let match
    while (match = re.exec(text)) { //eslint-disable-line no-cond-assign
        res.push(onText(text.slice(last, match.index)))
        res.push(cb(match))
        last = match.index + match[0].length
        if (!re.global) break
    }
    return h(Fragment, {}, ...res, onText(text.slice(last, Infinity)))
}

export function Html({ children, ...rest }: { children?: string } & HTMLAttributes<any>) {
    return useMemo(() => !children ? null
        : h('span', { ...rest, ref: x => x && x.replaceChildren(document.createRange().createContextualFragment(children)) }),
    [children])
}

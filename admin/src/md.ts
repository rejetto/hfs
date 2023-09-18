// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment, ReactNode } from 'react'
import { Link } from '@mui/material'

const TAGS = {
    '`': 'code',
    '*': 'i',
    '**': 'b',
}
type OnText = (s: string) => ReactNode
export default function md(text: string | TemplateStringsArray, { linkTarget='_blank', onText=(x=>x) as OnText }={}) {
    if (typeof text !== 'string')
        text = text[0]
    return replaceStringToReact(text, /(`|_|\*\*?)(.+?)\1|(\n)|\[(.+?)\]\((.+?)\)|<([^ >/]+)>(.*?)<\/\6>|<([^ >/]+) *\/>/g, m =>
        m[4] ? h(Link, { href: m[5], target: linkTarget }, onText(m[4]))
            : m[3] ? h('br')
            : m[1] ? h((TAGS as any)[ m[1] ] || Fragment, {}, onText(m[2]))
            : h(m[6] || m[8], {}, m[7]),
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

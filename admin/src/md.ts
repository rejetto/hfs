// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react'

// markdown inspired syntax to transform text into react elements: * for bold, / for italic, _ for underline, ` for code
export default function md(text: string | TemplateStringsArray) {
    if (typeof text !== 'string')
        text = text[0]
    const re = /([`*/_])(.+)\1|(\n)/g
    const res = []
    let last = 0
    let match
    while (match = re.exec(text)) { //eslint-disable-line no-cond-assign
        res.push( text.slice(last, match.index) )
        if (match[3])
            res.push(h('br'))
        else {
            const tag = ({
                '`': 'code',
                '*': 'b',
                '/': 'i',
                '_': 'u',
            })[ match[1] ]
            if (!tag)
                throw Error("should never happen")
            res.push( h(tag,{}, match[2]) )
        }
        last = match.index + match[0].length
    }
    return h(Fragment, {}, ...res, text.slice(last, Infinity))
}

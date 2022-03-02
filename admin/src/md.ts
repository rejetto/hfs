// This file is part of HFS - Copyright 2020-2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { createElement as h, Fragment } from 'react'

// markdown inspired syntax to transform text into react elements: * for bold, / for italic, _ for underline, ` for code
export default function md(text: string) {
    const re = /([`*/_])(.+)\1/g
    const res = []
    let last = 0
    let match
    while (match = re.exec(text)) { //eslint-disable-line no-cond-assign
        const tag = ({
            '`': 'code',
            '*': 'b',
            '/': 'i',
            '_': 'u',
        })[ match[1] ]
        if (!tag)
            throw Error("should never happen")
        res.push( text.slice(last, match.index), h(tag,{}, match[2]) )
        last = match.index + match[0].length
    }
    return h(Fragment, {}, ...res, text.slice(last, Infinity))
}

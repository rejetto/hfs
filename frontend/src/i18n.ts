import { findFirst, getHFS } from './misc'
import { createElement as h, Fragment } from 'react'
import { proxy, useSnapshot } from 'valtio'

const state = proxy<{ langs: string[], embedded: string }>({ embedded: '', langs: [] })
const warns = new Set() // avoid duplicates
let loaded: any // all dictionaries

// the hook ensures translation is refreshed when language changes
export function useI18N() {
    useSnapshot(state)
    return { t }
}

export function I18Nprovider({ embedded='en', ...props }) {
    loaded = getHFS().lang
    state.embedded = embedded
    state.langs = Object.keys(loaded||{})
    return h(Fragment, props)
}

export function t(keyOrTpl: string | string[] | TemplateStringsArray, params?: any, def?: string) {
    // memoize?
    const keys = isTemplateStringsArray(keyOrTpl) ? [(def ??= keyOrTpl[0] as string)]
        : Array.isArray(keyOrTpl) ? keyOrTpl : [keyOrTpl]
    if (typeof params === 'string' && !def) {
        def = params
        params = null
    }
    let found
    let selectedLang = '' // keep track of where we find the translation
    const { langs, embedded } = state
    if (loaded) {
        for (const key of keys) {
            found = findFirst(langs, lang => loaded[selectedLang=lang]?.translate?.[key])
            if (found) break
            if (selectedLang && langs[0] !== embedded && !warns.has(key)) {
                warns.add(key)
                console.debug("miss i18n:", key)
            }
        }
    }
    if (!found) {
        found = def || keys[0]
        selectedLang = embedded
    }
    return Array.from(tokenizer(found)).map(([s,inside]) => {
        if (!inside) return s
        const [k,cmd,rest] = s.split(',')
        if (!params) throw "missing params on " + keys[0]
        const v = params[k]
        if (cmd === 'plural')
            return plural(v, rest)
        return v || v === 0 ? v : ''
    }).join('')

    function plural(v: any, rest: string) {
        const plural = new Intl.PluralRules(selectedLang || embedded).select(Number(v))
        let other = ''
        let pickNext = false
        let collectOther = false
        for (const [s,inside] of tokenizer(rest)) {
            if (pickNext)
                return pick(s)
            if (collectOther) {
                other = s
                collectOther = false
            }
            if (inside) continue
            const selectors = s.trim().split(/\s+/)
            pickNext = selectors.some(sel =>
                sel[0] === '=' && v === Number(sel.slice(1))
                || sel === plural )
            collectOther = !pickNext && selectors.includes('other')
        }
        return pick(other)

        function pick(s: string) {
            return s.replace('#', String(v))
        }
    }
}

function* tokenizer(s:string): Generator<[string,boolean]> {
    let ofs = 0
    while (1) {
        const open = s.indexOf('{', ofs)
        if (open < 0) break
        yield [s.slice(ofs, open), false]
        let stack = 1
        ofs = open + 1
        while (stack && ofs < s.length) {
            if (s[ofs] === '{')
                stack++
            else if (s[ofs] === '}')
                stack--
            ofs++
        }
        if (stack)
            return console.debug('tokenizer: unclosed') // invalid, abort
        yield [s.slice(open + 1, ofs-1), true]
    }
    yield [s.slice(ofs), false]
}

function isTemplateStringsArray(x: any): x is TemplateStringsArray {
    return x?.raw && Array.isArray(x)
}
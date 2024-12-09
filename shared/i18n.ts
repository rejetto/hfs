// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { proxy, useSnapshot } from 'valtio'
import { watch } from 'valtio/utils'

export function i18nFromTranslations(translations: Record<string, any>) {
    const state = proxy({
        embedded: '',
        translations, // all dictionaries
    })
    const searchLangs: string[] = []
    watch(get => {
        const snapshot = get(state)
        searchLangs.splice(0, Infinity, 'all', ...Object.keys(snapshot.translations), snapshot.embedded) // replace completely
    })

    const warns = new Set() // avoid duplicates

    function getLangs() {
        return Object.keys(state.translations)
    }

// If one of the keys is an "id", that should be the first. If one of the keys should work as a fallback, that should be the last. Use 'fallback' parameter if you don't want the fallback to work as a key.
    function t(keyOrTpl: string | string[] | TemplateStringsArray, params?: any, fallback?: string) {
        if (!keyOrTpl)
            return ''
        // memoize?
        const keys = isTemplateStringsArray(keyOrTpl) ? [(fallback ??= keyOrTpl[0] as string)]
            : Array.isArray(keyOrTpl) ? keyOrTpl : [keyOrTpl]
        if (typeof params === 'string' && !fallback) {
            fallback = params
            params = null
        }
        let found
        let selectedLang = '' // keep track of where we find the translation
        const { embedded } = state
        const langs = Object.keys(state.translations)
        for (const key of keys) {
            for (const lang of searchLangs)
                if (found = state.translations[selectedLang=lang]?.translate?.[key]) break
            if (!warns.has(key) && langs.length && langs[0] !== embedded) {
                warns.add(key)
                console.debug("miss i18n:", key)
            }
        }
        if (!found) {
            found = fallback || keys[keys.length - 1]
            selectedLang = embedded
        }
        return Array.from(tokenizer(found)).map(([s,inside]) => {
            if (!inside) return s
            const [k,cmd,rest] = s.split(',')
            if (!params) throw "missing params on " + keys[0]
            const v = k && params[k]
            if (cmd === 'plural' && rest)
                return plural(v, rest)
            return v || v === 0 ? v : ''
        }).join('')

        function plural(v: any, rest: string) {
            const plural = !Intl.PluralRules ? 'other'
                : new Intl.PluralRules(selectedLang || embedded).select(Number(v))
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

    return {
        t,
        getLangs,
        i18nWrapperProps(embedded='en') {
            return { lang: getLangs()[0] || (state.embedded = embedded) }
        },
        useI18N() { // the hook ensures translation is refreshed when language changes
            useSnapshot(state)
            return { t }
        }
    }
}
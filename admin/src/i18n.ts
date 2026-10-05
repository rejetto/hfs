// This file is part of HFS - Copyright 2021-2026, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getHFS, try_ } from '@hfs/shared'
import { i18nFromTranslations } from '../../src/i18n'

const i18n = i18nFromTranslations(getHFS().lang || {})
export const { t, useI18N } = i18n
export const language = Object.keys(getHFS().lang || {})[0] || "en"
export const locale = detectLocale()
export const isRtl = language === "ar"
document.documentElement.lang = language
document.documentElement.dir = isRtl ? "rtl" : "ltr"
const english = getHFS().lang?.en?.translate as Record<string, string> || {}
const englishKeys = new Map(Object.entries(english).map(([key, value]) => [value, key]))

function detectLocale() {
    const selected = try_(() => new Intl.Locale(language))
    if (!selected) return navigator.language
    const script = selected.maximize().script
    // preserve the translation script while borrowing only the browser's regional conventions
    return selected.region ? language : navigator.languages.find(code => {
        const candidate = new Intl.Locale(code)
        return candidate.language === selected.language && candidate.maximize().script === script
    }) || language
}

export function translateText(value: string) {
    const exactKey = englishKeys.get(value)
    return exactKey ? t(exactKey) : value
}

export function translateObject(value: any): any {
    return typeof value === "string" ? translateText(value)
        : typeof value === "function" ? (...args: any[]) => translateObject(value(...args))
            : Array.isArray(value) ? value.map(translateObject)
                : value && typeof value === 'object'
                    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, translateObject(child)]))
                    : value
}

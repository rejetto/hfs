// This file is part of HFS - Copyright 2021-2026, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { getHFS } from '@hfs/shared'
import { i18nFromTranslations } from '../../src/i18n'

const i18n = i18nFromTranslations(getHFS().lang || {})
export const { t, useI18N } = i18n
export const language = Object.keys(getHFS().lang || {})[0] || "en"
export const isRtl = language === "ar"
document.documentElement.lang = language
document.documentElement.dir = isRtl ? "rtl" : "ltr"
const english = getHFS().lang?.en?.translate as Record<string, string> || {}
const englishKeys = new Map(Object.entries(english).map(([key, value]) => [value, key]))

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

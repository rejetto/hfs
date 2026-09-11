/// <reference types="vite/client" />
import { findDefined } from './misc'
import dayjs from 'dayjs'

const localeLoaders = import.meta.glob<{ default: ILocale }>('../../node_modules/dayjs/esm/locale/*.js')
const localePaths = new Map(Object.keys(localeLoaders).map(path => [path.match(/([^/]+)\.js$/)![1], path]))
const localeAliases: Record<string, string> = { zn: 'zh-cn', no: 'nb' }

function lang2locale(lang: string): string | undefined {
    const normalized = lang.toLowerCase()
    return localePaths.has(normalized) && normalized
        || localeAliases[normalized]
        || normalized.includes('-') && lang2locale(normalized.split('-')[0])
        || undefined
}

export function getLocale() {
    return findDefined([navigator.language, ...navigator.languages], lang2locale)
}

export async function loadLocale() {
    const locale = getLocale()
    if (!locale)
        return
    const loaded = await localeLoaders[localePaths.get(locale)!]?.()
    // esm uses a separate instance; preserve already registered locales and their plugin extensions
    if (loaded && !dayjs.Ls[locale])
        dayjs.locale(loaded.default, undefined, true)
    return locale
}

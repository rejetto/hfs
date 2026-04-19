/// <reference types="vite/client" />
import { findDefined } from './misc'

const localeLoaders = import.meta.glob('../../node_modules/dayjs/locale/*.js')
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
    // AdapterDayjs needs the matching dayjs locale module registered before adapterLocale can use it.
    await localeLoaders[localePaths.get(locale)!]?.()
    return locale
}

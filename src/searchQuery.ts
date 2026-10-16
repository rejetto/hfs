import { writePluginSearchQuery } from './pluginSearchQuery'

const SEARCH_QUERY_KEYS = {
    search: 'search', searchComment: 'searchComment', wild: 'searchWild', pluginSearch: 'searchPlugins',
    creationMin: 'searchCreationMin', creationMax: 'searchCreationMax',
    mtimeMin: 'searchMtimeMin', mtimeMax: 'searchMtimeMax', sizeMin: 'searchSizeMin', sizeMax: 'searchSizeMax',
} as const
type SearchKey = keyof typeof SEARCH_QUERY_KEYS

export function readSearchQuery<T>(params: Record<string, T>) {
    // keep existing shared links readable while giving the new names precedence
    return Object.fromEntries(Object.entries(SEARCH_QUERY_KEYS).map(([key, queryKey]) =>
        [key, params[queryKey] ?? params[key]])) as Partial<Record<SearchKey, T>>
}

export function writeSearchQuery(params: URLSearchParams, values?: Partial<Record<SearchKey, string>>) {
    for (const [key, queryKey] of Object.entries(SEARCH_QUERY_KEYS)) {
        params.delete(key)
        params.delete(queryKey)
        const value = values?.[key as SearchKey]
        if (value) params.set(queryKey, value)
    }
    writePluginSearchQuery(params, values?.pluginSearch)
    return params
}

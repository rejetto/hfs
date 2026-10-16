export function parsePluginSearch(raw: unknown): Record<string, unknown> {
    const value = raw === undefined ? {} : JSON.parse(String(raw))
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error("Invalid plugin search")
    return value
}

export function readPluginSearchQuery(params: Record<string, unknown>) {
    const values = parsePluginSearch(params.searchPlugins ?? params.pluginSearch)
    const compact = Object.entries(params).filter(([key]) => key.startsWith('ps.') || key.startsWith('searchPlugin.'))
    for (const [key, value] of compact)
        if (key === 'ps.' || key === 'searchPlugin.' || typeof value !== 'string') throw Error("Invalid plugin search")
    // canonical parameters take precedence when an existing link contains both spellings
    compact.sort(([a], [b]) => Number(a.startsWith('searchPlugin.')) - Number(b.startsWith('searchPlugin.')))
    return Object.fromEntries([...Object.entries(values), ...compact.map(([key, value]) => [key.slice(key.startsWith('ps.') ? 3 : 13), value])])
}

export function writePluginSearchQuery(params: URLSearchParams, raw?: string) {
    params.delete('pluginSearch')
    params.delete('searchPlugins')
    for (const key of Array.from(params.keys()))
        if (key.startsWith('ps.') || key.startsWith('searchPlugin.')) params.delete(key)
    let values: Record<string, unknown>
    try { values = parsePluginSearch(raw) }
    catch {
        // preserve invalid criteria so the server rejects them rather than running an unfiltered search
        if (raw !== undefined) params.set('searchPlugins', raw)
        return
    }
    const json = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value !== 'string'))
    if (Object.keys(json).length) params.set('searchPlugins', JSON.stringify(json))
    for (const [id, value] of Object.entries(values))
        if (typeof value === 'string') params.set('searchPlugin.' + id, value)
}

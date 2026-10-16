import type { Context } from 'koa'
import type { VfsNodeWithPath } from './vfs'
import type { Promisable } from './cross'
import { ApiError } from './apiMiddleware'

export interface PluginSearch {
    label: string
    // undefined means the entry could not yet be tested, rather than a negative match
    prepare(value: unknown, ctx: Context): Promisable<(node: VfsNodeWithPath) => Promisable<boolean | undefined>>
}

const providers = new Map<string, PluginSearch>()

export function registerPluginSearch(id: string, provider: PluginSearch) {
    if (providers.has(id)) throw Error(`Search already registered: ${id}`)
    providers.set(id, provider)
    let registered = true
    return () => {
        // manual cleanup is called again on unload and must not unregister a replacement
        if (registered) {
            registered = false
            providers.delete(id)
        }
    }
}

export function getPluginSearchFields() {
    return Array.from(providers, ([id, { label }]) => ({ id, label }))
}

export async function preparePluginSearch(raw: unknown, ctx: Context) {
    let values: unknown
    try { values = raw === undefined ? {} : JSON.parse(String(raw)) }
    catch { throw new ApiError(400, "Invalid plugin search") }
    if (!values || typeof values !== 'object' || Array.isArray(values))
        throw new ApiError(400, "Invalid plugin search")
    const filters = await Promise.all(Object.entries(values).map(async ([id, value]) => {
        const provider = providers.get(id)
        if (!provider) throw new ApiError(400, `Search unavailable: ${id}`)
        return { id, provider, test: await provider.prepare(value, ctx) }
    }))
    const incomplete = new Set<string>()
    return {
        active: Boolean(filters.length),
        incomplete,
        async test(node: VfsNodeWithPath) {
            const unknown: string[] = []
            for (const { id, provider, test } of filters) {
                // a running search must not keep calling an unloaded plugin and its closed database
                if (providers.get(id) !== provider)
                    throw new ApiError(503, `Search unavailable: ${id}`)
                const result = await test(node)
                if (providers.get(id) !== provider)
                    throw new ApiError(503, `Search unavailable: ${id}`)
                if (result === false) return false
                if (result === undefined)
                    unknown.push(id)
            }
            // missing data is irrelevant when another AND filter has already excluded this entry
            for (const id of unknown)
                incomplete.add(id)
            return !unknown.length
        },
    }
}

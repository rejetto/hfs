import { apiGithubPaginated, getProjectInfo, readOnlineCompatiblePlugin } from './github'
import { storedMap } from './persistence'
import { VERSION } from './const'
import type { InactivePlugin } from './plugins'
import _ from 'lodash'

type Repository = {
    full_name: string
    description: string | null
    pushed_at: string
    default_branch: string
    stargazers_count: number
    license: { spdx_id: string } | null
}
type Catalog = {
    version: string
    updatedAt: number
    entries: { repository: Repository, plugin: InactivePlugin | null }[]
}

const CACHE_KEY = 'pluginCatalog'
let refreshing: Promise<Catalog> | undefined

export async function *getPluginCatalog() {
    await storedMap.ready()
    const saved = await storedMap.get(CACHE_KEY) as Catalog | undefined
    // compatibility is determined by this HFS version, including fallback api branches
    const previous = saved?.version === VERSION ? saved : undefined
    const age = previous ? Date.now() - previous.updatedAt : Infinity
    if (previous && age < 24 * 60 * 60_000)
        yield { ...previous, refreshing: age >= 5 * 60_000 }
    if (age < 5 * 60_000) return
    // all searches share the same refresh, even if the initiating client disconnects
    refreshing ??= refresh().finally(() => { refreshing = undefined })
    yield { ...await refreshing, refreshing: false }

    async function refresh(): Promise<Catalog> {
        const repositories: Repository[] = []
        for await (const repo of apiGithubPaginated<Repository>('search/repositories?q=topic:hfs-plugin', { requireComplete: true }))
            repositories.push(_.pick(repo, ['full_name', 'description', 'pushed_at', 'default_branch', 'stargazers_count', 'license']))
        const old = new Map(previous?.entries.map(entry => [entry.repository.full_name, entry]))
        const entries = await Promise.all(repositories.map(async repository => {
            const cached = old.get(repository.full_name)
            let plugin = cached?.plugin
            if (!cached || cached.repository.pushed_at !== repository.pushed_at
                || cached.repository.default_branch !== repository.default_branch) {
                plugin = await readOnlineCompatiblePlugin(repository.full_name, repository.default_branch)
                    .catch((error: Error) => {
                        // repositories can carry the topic without providing a plugin at the expected path
                        if (error.message !== '404') throw error
                    }) ?? null
            }
            return { repository, plugin: plugin ?? null }
        }))
        const next = { version: VERSION, updatedAt: Date.now(), entries }
        // never replace a complete catalog with the result of a failed refresh
        await storedMap.put(CACHE_KEY, next)
        return next
    }
}

export async function searchPluginCatalog(catalog: Catalog, text='', skipRepos: string[]=[]) {
    const central = await getProjectInfo()
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean)
    return catalog.entries.flatMap(({ repository, plugin }) => {
        const repo = repository.full_name
        const searchable = `${repo} ${repository.description || ''} ${plugin?.description || ''}`.toLowerCase()
        if (!plugin || skipRepos.includes(repo) || central?.repo_blacklist?.[repo]?.message
            || !terms.every(term => searchable.includes(term))) return []
        // API responses add live state and dependency errors; keep the persisted metadata untouched
        return [{ ...plugin, id: repo, repo, pushed_at: repository.pushed_at,
            stargazers_count: repository.stargazers_count, default_branch: repository.default_branch,
            license: repository.license?.spdx_id }]
    })
}

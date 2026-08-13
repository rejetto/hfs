import { randomUUID } from 'node:crypto'
import { CFG, DAY, HOUR, PLUGIN_USAGE_URL, repeat } from './misc'
import { configReady, currentVersion, defineConfig } from './config'
import { enablePlugins, getInactivePlugins, mapPlugins, pluginsScanned, type Repo } from './plugins'
import { storedMap } from './persistence'
import { httpWithBody } from './util-http'
import { debounceAsync } from './debounceAsync'

type PluginUsageSource = {
    id: string
    repo?: Repo
    version?: number
    enabled: boolean
}

const shareUsageStats = defineConfig(CFG.share_usage_stats, false)
const installationId = storedMap.singleSync<string>('pluginUsageId', '')
const lastReport = storedMap.singleSync<number>('lastPluginUsageReport', 0)
const ready = Promise.all([configReady, pluginsScanned, installationId.ready(), lastReport.ready()])

const syncPluginUsage = debounceAsync(async () => {
    await ready
    let uuid = installationId.get()
    if (!shareUsageStats.get()) {
        if (!uuid) return
        await send('DELETE', { uuid })
        installationId.set('')
        lastReport.set(0)
        return
    }
    if (Date.now() < lastReport.get() + DAY) return
    if (!uuid) {
        uuid = randomUUID()
        installationId.set(uuid)
    }
    const enabled = enablePlugins.get()
    const plugins = selectReportedPlugins([
        ...mapPlugins((plugin, id) => ({ ...plugin.getData(), id, enabled: enabled.includes(id) }), false),
        ...getInactivePlugins().map(plugin => ({ ...plugin, enabled: enabled.includes(plugin.id) })),
    ])
    await send('POST', { uuid, hfsVersion: String(currentVersion), plugins })
    lastReport.set(Date.now())

    function selectReportedPlugins(installed: PluginUsageSource[]) {
        const selected = new Map<string, PluginUsageSource>()
        for (const plugin of installed) {
            const repo = typeof plugin.repo === 'string' ? plugin.repo : plugin.repo?.main
            if (!repo) continue
            const current = selected.get(repo)
            if (!current || better(plugin, current))
                selected.set(repo, plugin)
        }
        return Array.from(selected, ([repo, plugin]) => ({
            repo,
            version: plugin.version,
            enabled: plugin.enabled,
        })).sort((a, b) => a.repo.localeCompare(b.repo))

        function better(a: PluginUsageSource, b: PluginUsageSource) {
            return Number(a.enabled) > Number(b.enabled)
                || a.enabled === b.enabled && (a.id.length < b.id.length
                    || a.id.length === b.id.length && a.id.localeCompare(b.id) < 0)
        }
    }
})

shareUsageStats.sub(() => void syncPluginUsage().catch(() => {}))
repeat(HOUR, syncPluginUsage)

async function send(method: 'POST' | 'DELETE', body: object) {
    await httpWithBody(PLUGIN_USAGE_URL + '/report', { method, body, timeout: 5000 })
}

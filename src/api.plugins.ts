// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    InactivePlugin, enablePlugins, getInactivePlugins, getPluginConfigFields, mapPlugins, Plugin, pluginsConfig,
    PATH as PLUGINS_PATH, enablePlugin, getPluginInfo, setPluginConfig, isPluginRunning, pluginsScanned,
    stopPlugin, startPlugin, CommonPluginInterface, getMissingDependencies, findPluginByRepo, suspendPlugins,
    firstPlugin,
} from './plugins'
import _ from 'lodash'
import { apiAssertTypes, HTTP_CONFLICT, HTTP_PRECONDITION_FAILED, newObj, waitFor } from './misc'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { rm } from 'fs/promises'
import {
    downloadPlugin, getFolder2repo, readOnlineCompatiblePlugin, readOnlinePlugin, downloading
} from './github'
import { HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from './const'
import { SendListReadable } from './SendList'
import { getPluginCatalog, searchPluginCatalog } from './pluginCatalog'

const apis: ApiHandlers = {

    get_plugins({ skipInitial }, ctx) {
        const list = new SendListReadable({ addAtStart: skipInitial ? [] : [ ...mapPlugins(serialize, false), ...getInactivePlugins().map(serialize) ] })
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped pluginUpdated': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
            pluginLog: id => list.update({ id }, { log: true }) // SendList is already capping frequency
        })
    },

    async get_plugin_updates({ skipInitial }, ctx) {
        return new SendListReadable({
            async doAtStart(list) {
                const errs: any = {}
                list.events(ctx, {
                    pluginDownload({ repo, status }) {
                        list.update({ id: findPluginByRepo(repo)?.id }, { downloading: status ?? null })
                    },
                    pluginDownloaded({ id }) {
                        list.update({ id }, { updated: true })
                    }
                })
                if (skipInitial) return list.ready()
                await pluginsScanned
                await Promise.allSettled(_.map(getFolder2repo(), async (repo, folder) => {
                    try {
                        if (!repo) return
                        const online = await readOnlineCompatiblePlugin(repo)
                        if (!online) return
                        const disk = getPluginInfo(folder)
                        if (!disk) return // plugin removed in the meantime?
                        if (online.version === disk.version) return // different, not just newer ones, in case a version was retired
                        list.add(Object.assign(online, {
                            id: disk.id, // id is installation-dependant, and online cannot know
                            installedVersion: disk.version,
                            repo: serialize(disk).repo, // show the user the current repo we are getting this update from, not a possibly-changed future one
                            downgrade: online.version! < disk.version,
                            downloading: _.isString(online.repo) && downloading[online.repo],
                        }))
                    } catch (err: any) {
                        if (err.message !== '404') // the plugin is declaring a wrong repo
                            (errs[err.code || err.message] ||= []).push(repo)
                    }
                }))
                if (!_.isEmpty(errs))
                    list.error(errs)
                list.ready()
            }
        })
    },

    async start_plugin({ id }) {
        assertPluginId(id)
        if (isPluginRunning(id))
            return serializeRunningPlugin(id)
        if (suspendPlugins.get())
            return new ApiError(HTTP_PRECONDITION_FAILED, 'all plugins suspended')
        await stopPlugin(id)
        try { await startPlugin(id) }
        catch(e: any) { return new ApiError(HTTP_SERVER_ERROR, e.message) }
        return serializeRunningPlugin(id)
    },

    async stop_plugin({ id }) {
        assertPluginId(id)
        if (!isPluginRunning(id))
            return { msg: 'already stopped' }
        await stopPlugin(id)
        return {}
    },

    async set_plugin({ id, enabled, config }) {
        assertPluginId(id)
        if (config)
            setPluginConfig(id, config)
        if (enabled !== undefined)
            enablePlugin(id, enabled)
        return {}
    },

    async get_plugin({ id }) {
        assertPluginId(id)
        return {
            enabled: enablePlugins.get().includes(id),
            config: {
                ...newObj(getPluginConfigFields(id), v => v?.defaultValue),
                ...pluginsConfig.get()[id]
            }
        }
    },

    get_online_plugins({ text, skipInitial }, ctx) {
        if (text !== undefined && !_.isString(text))
            return new ApiError(HTTP_BAD_REQUEST, 'bad text')
        return new SendListReadable({
            async doAtStart(list) {
                // resumed clients retain their own rows; updates for other repos are ignored by useApiList
                const repos = [] as string[]
                list.events(ctx, {
                    pluginInstalled: p => {
                        if (skipInitial || repos.includes(p.repo))
                            list.update({ id: p.repo }, { installed: true })
                    },
                    pluginUninstalled: (_folder, repo) => {
                        if (typeof repo !== 'string') return // custom repo
                        if (skipInitial || repos.includes(repo))
                            list.update({ id: repo }, { installed: false })
                    },
                    pluginDownload({ repo, status }) {
                        if (skipInitial || repos.includes(repo))
                            list.update({ id: repo }, { downloading: status ?? null })
                    }
                })
                if (skipInitial) return list.ready()
                let updatedAt: number | undefined
                let previous = new Map<string, object>()
                try {
                    for await (const snapshot of getPluginCatalog()) {
                        const already = Object.values(getFolder2repo()).filter(Boolean).map(String)
                        const plugins = await searchPluginCatalog(snapshot, text, already)
                        if (ctx.isAborted()) return
                        const rows = plugins.map(pl => {
                            const missing = getMissingDependencies(pl)
                            return { ...pl, missing: missing.length ? missing : null, downloading: downloading[pl.repo] ?? null }
                        })
                        // reconcile snapshots without dropping selection or retaining obsolete optional metadata
                        for (const id of previous.keys())
                            if (!rows.some(row => row.id === id)) list.remove({ id })
                        for (const row of rows) {
                            const old = previous.get(row.id)
                            if (old)
                                list.update({ id: row.id }, { ..._.mapValues(old, () => null), ..._.mapValues(row, value => value ?? null) })
                            else
                                list.add(row)
                        }
                        previous = new Map(rows.map(row => [row.id, row]))
                        repos.splice(0, repos.length, ...rows.map(row => row.repo))
                        updatedAt = snapshot.updatedAt
                        list.props({ updatedAt, refreshing: snapshot.refreshing })
                        list.ready()
                    }
                } catch (err: any) {
                    list.props({ updatedAt, refreshing: false })
                    list.error(err.code || err.message)
                }
                list.ready()
            }
        })
    },

    async download_plugin({ id, branch, stop }) {
        assertPluginId(id)
        await checkDependencies(await readOnlinePlugin(id, branch))
        const folder = await downloadPlugin(id, { branch })
        if (stop) // be sure this is not automatically started
            await stopPlugin(folder)
        return (await waitFor(() => getPluginInfo(folder), { timeout: 5000 }))
            || new ApiError(HTTP_SERVER_ERROR)
    },

    async update_plugin({ id }) {
        assertPluginId(id)
        const found = getPluginInfo(id)
        if (!found)
            return new ApiError(HTTP_NOT_FOUND)
        const online = await readOnlineCompatiblePlugin(found.repo) // branch returned by readOnlineCompatiblePlugin is possibly fresher, so we use that
        if (!online)
            return new ApiError(HTTP_CONFLICT)
        await checkDependencies(online)
        await downloadPlugin(found.repo, { branch: online.branch, overwrite: true })
        return {}
    },

    async uninstall_plugin({ id, deleteConfig }) {
        assertPluginId(id)
        if (!getPluginInfo(id))
            return new ApiError(HTTP_NOT_FOUND)
        await stopPlugin(id)
        await rm(PLUGINS_PATH + '/' + id,  { recursive: true, force: true })
        if (deleteConfig)
            setPluginConfig(id, null)
        return {}
    },

    get_plugin_log({ id, skipInitial }, ctx) {
        assertPluginId(id)
        const p = getPluginInfo(id)
        if (!p)
            return new ApiError(HTTP_NOT_FOUND)
        const list = new SendListReadable({ addAtStart: skipInitial ? [] : p.log })
        return list.events(ctx, {
            ['pluginLog:' + id]: x => list.add(x)
        })
    },

}

export default apis

function assertPluginId(id: unknown) {
    apiAssertTypes({ string: { id } })
}

function serialize(p: Readonly<Plugin> | InactivePlugin) {
    let o = 'getData' in p ? Object.assign(_.pick(p, ['id','started']), p.getData())
        : { ...p } // _.defaults mutates object, and we don't want that
    if (typeof o.repo === 'object') // custom repo
        o.repo = o.repo.web
    o.log = 'log' in p && p.log?.length > 0
    o.config &&= _.isFunction(o.config) ? String(o.config)
        : JSON.stringify(o.config, (_k, v) => _.isFunction(v) ? String(v) : v) // allow simple functions
    return _.defaults(o, { started: null, badApi: null }) // nulls should be used to be sure to overwrite previous values,
}

function serializeRunningPlugin(id: string) {
    const plugin = firstPlugin((plugin, pluginId) => pluginId === id ? plugin : undefined)
    return plugin ? serialize(plugin) : new ApiError(HTTP_SERVER_ERROR)
}

export async function checkDependencies(plugin: CommonPluginInterface) {
    const miss = await getMissingDependencies(plugin)
    if (miss.length)
        throw new ApiError(HTTP_FAILED_DEPENDENCY, miss)
}

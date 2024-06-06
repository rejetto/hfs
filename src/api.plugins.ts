// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    AvailablePlugin, enablePlugins, getAvailablePlugins, getPluginConfigFields, mapPlugins, Plugin, pluginsConfig,
    PATH as PLUGINS_PATH, enablePlugin, getPluginInfo, setPluginConfig, isPluginRunning,
    stopPlugin, startPlugin, CommonPluginInterface, getMissingDependencies,
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { HTTP_CONFLICT, newObj, waitFor } from './misc'
import { ApiError, ApiHandlers } from './apiMiddleware'
import { rm } from 'fs/promises'
import { downloadPlugin, getFolder2repo, readOnlineCompatiblePlugin, readOnlinePlugin, searchPlugins } from './github'
import { HTTP_FAILED_DEPENDENCY, HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from './const'
import { SendListReadable } from './SendList'

const apis: ApiHandlers = {

    get_plugins({}, ctx) {
        const list = new SendListReadable({ addAtStart: [ ...mapPlugins(serialize, false), ...getAvailablePlugins().map(serialize) ] })
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped pluginUpdated': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
        })
    },

    async get_plugin_updates() {
        return new SendListReadable({
            async doAtStart(list) {
                const errs: string[] = []
                await Promise.allSettled(_.map(getFolder2repo(), async (repo, folder) => {
                    try {
                        if (!repo) return
                        const online = await readOnlineCompatiblePlugin(repo)
                        if (!online) return
                        const disk = getPluginInfo(folder)
                        if (!disk) return // plugin removed in the meantime?
                        if (online.version !== disk.version) { // not just newer one, in case a version was retired
                            online.id = disk.id // id is installation-dependant, and online cannot know
                            online.repo = serialize(disk).repo // show the user the current repo we are getting this update from, not a possibly-changed future one
                            list.add(online)
                        }
                    } catch (err: any) {
                        if (err.message !== '404') // the plugin is declaring a wrong repo
                            errs.push(err.code || err.message)
                    }
                }))
                for (const x of _.uniq(errs))
                    list.error(x)
                list.close()
            }
        })
    },

    async start_plugin({ id }) {
        if (isPluginRunning(id))
            return { msg: 'already running' }
        await stopPlugin(id)
        return startPlugin(id).then(() => 0, e => new ApiError(HTTP_SERVER_ERROR, e.message))
    },

    async stop_plugin({ id }) {
        if (!isPluginRunning(id))
            return { msg: 'already stopped' }
        await stopPlugin(id)
        return {}
    },

    async set_plugin({ id, enabled, config }) {
        assert(id, 'id')
        if (config)
            setPluginConfig(id, config)
        if (enabled !== undefined)
            enablePlugin(id, enabled)
        return {}
    },

    async get_plugin({ id }) {
        return {
            enabled: enablePlugins.get().includes(id),
            config: {
                ...newObj(getPluginConfigFields(id), v => v?.defaultValue),
                ...pluginsConfig.get()[id]
            }
        }
    },

    get_online_plugins({ text }, ctx) {
        return new SendListReadable({
            async doAtStart(list) {
                const repos = [] as string[]
                list.events(ctx, {
                    pluginInstalled: p => {
                        if (repos.includes(p.repo))
                            list.update({ id: p.repo }, { installed: true })
                    },
                    pluginUninstalled: folder => {
                        const repo = getFolder2repo()[folder]
                        if (typeof repo !== 'string') return // custom repo
                        if (repos.includes(repo))
                            list.update({ id: repo }, { installed: false })
                    },
                    pluginDownload({ id, status }) {
                        if (repos.includes(id))
                            list.update({ id }, { downloading: status ?? null })
                    }
                })
                try {
                    const already = Object.values(getFolder2repo()).map(String)
                    for await (const pl of await searchPlugins(text, { skipRepos: already })) {
                        const repo = pl.repo || pl.id // .repo property can be more trustworthy in case github user renamed and left the previous link in 'repo'
                        const missing = await getMissingDependencies(pl)
                        if (missing.length) pl.missing = missing
                        list.add(pl)
                        repos.push(repo)
                    }
                } catch (err: any) {
                    list.error(err.code || err.message)
                }
                list.ready()
            }
        })
    },

    async download_plugin({ id, branch, stop }) {
        await checkDependencies(await readOnlinePlugin(id, branch))
        const folder = await downloadPlugin(id, { branch })
        if (stop) // be sure this is not automatically started
            await stopPlugin(folder)
        return (await waitFor(() => getPluginInfo(folder), { timeout: 5000 }))
            || new ApiError(HTTP_SERVER_ERROR)
    },

    async update_plugin({ id, branch }) {
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
        await stopPlugin(id)
        await rm(PLUGINS_PATH + '/' + id,  { recursive: true, force: true })
        if (deleteConfig)
            setPluginConfig(id, null)
        return {}
    }

}

export default apis

function serialize(p: Readonly<Plugin> | AvailablePlugin) {
    const o = 'getData' in p ? Object.assign(_.pick(p, ['id','started']), p.getData())
        : { ...p } // _.defaults mutates object, and we don't want that
    if (typeof o.repo === 'object') // custom repo
        o.repo = o.repo.web
    return _.defaults(o, { started: null, badApi: null }) // nulls should be used to be sure to overwrite previous values,
}

export async function checkDependencies(plugin: CommonPluginInterface) {
    const miss = await getMissingDependencies(plugin)
    if (miss.length)
        throw new ApiError(HTTP_FAILED_DEPENDENCY, miss)
}
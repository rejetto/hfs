// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    AvailablePlugin, enablePlugins, getAvailablePlugins, getPluginConfigFields, mapPlugins, Plugin, pluginsConfig,
    PATH as PLUGINS_PATH, enablePlugin, getPluginInfo, setPluginConfig, isPluginEnabled, isPluginRunning,
    stopPlugin, startPlugin, CommonPluginInterface, getMissingDependencies,
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { Callback, newObj, onlyTruthy, onOff, waitFor } from './misc'
import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import events from './events'
import { rm } from 'fs/promises'
import { downloadPlugin, getFolder2repo, readOnlinePlugin, searchPlugins } from './github'
import { HTTP_FAILED_DEPENDENCY, HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from './const'

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
                const errs = await Promise.all(_.map(getFolder2repo(), async (repo, folder) => {
                    try {
                        if (!repo) return
                        //TODO shouldn't we consider other branches here?
                        const online = await readOnlinePlugin(repo)
                        if (!online?.apiRequired || online.badApi) return
                        const disk = getPluginInfo(folder)
                        if (!disk) return // plugin removed in the meantime?
                        if (online.version! > disk.version) { // it IS newer
                            online.id = disk.id // id is installation-dependant, and online cannot know
                            online.repo = serialize(disk).repo // show the user the current repo we are getting this update from, not a possibly-changed future one
                            list.add(online)
                        }
                    } catch (err: any) {
                        if (err.message === '404') // the plugin is declaring a wrong repo
                            return
                        return err.code || err.message
                    }
                }))
                for (const x of _.uniq(onlyTruthy(errs)))
                    list.error(x)
                list.close()
            }
        })
    },

    async start_plugin({ id }) {
        if (isPluginRunning(id))
            return { msg: 'already running' }
        await stopPlugin(id)
        await startPlugin(id)
        return {}
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
                ...newObj(getPluginConfigFields(id) ||{}, v => v?.defaultValue),
                ...pluginsConfig.get()[id]
            }
        }
    },

    get_online_plugins({ text }, ctx) {
        return new SendListReadable({
            async doAtStart(list) {
                try {
                    // avoid creating N listeners on ctx.req, and getting a warning
                    const undo: Callback[] = []
                    ctx.req.once('close', () => undo.forEach(x => x()))

                    const folder2repo = getFolder2repo()
                    for await (const pl of await searchPlugins(text)) {
                        const repo = pl.repo || pl.id // .repo property can be more trustworthy in case github user renamed and left the previous link in 'repo'
                        if (_.includes(folder2repo, repo)) continue // don't include installed plugins
                        list.add(pl)
                        // watch for events about this plugin, until this request is closed
                        undo.push(onOff(events, {
                            pluginInstalled: p => {
                                if (p.repo === repo)
                                    list.update({ id: repo }, { installed: true })
                            },
                            pluginUninstalled: folder => {
                                if (repo === getFolder2repo()[folder])
                                    list.update({ id: repo }, { installed: false })
                            },
                            ['pluginDownload_' + repo](status) {
                                list.update({ id: repo }, { downloading: status ?? null })
                            }
                        }))
                    }
                } catch (err: any) {
                    list.error(err.code || err.message)
                }
                list.ready()
            }
        })
    },

    async download_plugin({ id, branch }) {
        await checkDependencies(await readOnlinePlugin(id, branch))
        const res = await downloadPlugin(id, { branch })
        if (typeof res !== 'string')
            return res
        return (await waitFor(() => getPluginInfo(res), { timeout: 5000 }))
            || new ApiError(HTTP_SERVER_ERROR)
    },

    async update_plugin({ id }) {
        const found = getPluginInfo(id)
        if (!found)
            return new ApiError(HTTP_NOT_FOUND)
        await checkDependencies(found)
        const enabled = isPluginEnabled(id)
        await stopPlugin(id)
        await downloadPlugin(found.repo, { overwrite: true })
        if (enabled)
            startPlugin(id).then() // don't wait, in case it fails to start
        return {}
    },

    async uninstall_plugin({ id }) {
        await stopPlugin(id)
        await rm(PLUGINS_PATH + '/' + id,  { recursive: true, force: true })
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
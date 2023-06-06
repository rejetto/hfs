// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import {
    AvailablePlugin,
    enablePlugins,
    getAvailablePlugins,
    getPluginConfigFields,
    mapPlugins,
    Plugin,
    pluginsConfig,
    PATH as PLUGINS_PATH,
    enablePlugin,
    getPluginInfo,
    setPluginConfig,
    findPluginByRepo,
    isPluginEnabled,
    isPluginRunning, stopPlugin, startPlugin,
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { Callback, newObj, onOff, waitFor } from './misc'
import { ApiError, ApiHandlers, SendListReadable } from './apiMiddleware'
import events from './events'
import { rm } from 'fs/promises'
import { downloadPlugin, getFolder2repo, readOnlinePlugin, searchPlugins } from './github'
import { HTTP_FAILED_DEPENDENCY, HTTP_NOT_FOUND, HTTP_SERVER_ERROR } from './const'

const apis: ApiHandlers = {

    get_plugins({}, ctx) {
        const list = new SendListReadable({ addAtStart: [ ...mapPlugins(serialize), ...getAvailablePlugins() ] })
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped pluginUpdated': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
        })

        function serialize(p: Readonly<Plugin> | AvailablePlugin) {
            const o = 'getData' in p ? Object.assign(_.pick(p, ['id','started']), p.getData())
                    : { ...p } // _.defaults mutates object, and we don't want that
            return _.defaults(o, { started: null, badApi: null }) // nulls should be used to be sure to overwrite previous values,
        }
    },

    async get_plugin_updates() {
        const list = new SendListReadable()
        setTimeout(async () => {
            for (const [folder, repo] of Object.entries(getFolder2repo()))
                try {
                    if (!repo) continue
                    //TODO shouldn't we consider other branches here?
                    const online = await readOnlinePlugin(repo)
                    if (!online.apiRequired || online.badApi) continue
                    const disk = getPluginInfo(folder)
                    if (online.version! > disk.version)
                        list.add(online)
                }
                catch (err:any) {
                    list.error(err.code || err.message)
                }
            list.close()
        })
        return list
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

    search_online_plugins({ text }, ctx) {
        return new SendListReadable({
            async doAtStart(list) {
                try {
                    // avoid creating N listeners on ctx.req, and getting a warning
                    const undo: Callback[] = []
                    ctx.req.once('close', () => undo.forEach(x => x()))

                    const folder2repo = getFolder2repo()
                    for await (const pl of searchPlugins(text)) {
                        const repo = pl.id
                        if (_.includes(folder2repo, repo)) continue
                        const folder = _.findKey(folder2repo, x => x === repo)
                        const installed = folder && getPluginInfo(folder)
                        Object.assign(pl, {
                            update: installed && installed.version < pl.version!,
                        })
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
                            pluginUpdated: p => {
                                if (p.repo === repo)
                                    list.update({ id: repo }, { update: p.version < pl.version! })
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

    async download_plugin(pl) {
        await checkDependencies(pl.id, pl.branch)
        const res = await downloadPlugin(pl.id, pl.branch)
        if (typeof res !== 'string')
            return res
        return (await waitFor(() => getPluginInfo(res), { timeout: 5000 }))
            || new ApiError(HTTP_SERVER_ERROR)
    },

    async update_plugin(pl) {
        await checkDependencies(pl.id, pl.branch)
        const found = findPluginByRepo(pl.id) // github id !== local id
        if (!found)
            return new ApiError(HTTP_NOT_FOUND)
        const enabled = isPluginEnabled(found.id)
        await stopPlugin(found.id)
        await downloadPlugin(pl.id, pl.branch, true)
        if (enabled)
            startPlugin(found.id).then() // don't wait, in case it fails to start
        return {}
    },

    async uninstall_plugin({ id }) {
        await stopPlugin(id)
        await rm(PLUGINS_PATH + '/' + id,  { recursive: true, force: true })
        return {}
    }

}

export default apis

async function checkDependencies(repo: string, branch: string) {
    const rec = await readOnlinePlugin(repo, branch)
    const miss = rec.depend && rec.depend.map((dep: any) => {
        const res = findPluginByRepo(dep.repo)
        const error = !res ? 'missing'
            : (res.version || 0) < dep.version ? 'version'
                : !isPluginEnabled(res.id) ? 'disabled'
                    : !isPluginRunning(res.id) ? 'stopped'
                        : ''
        return error && { repo: dep.repo, error, id: res?.id }
    }).filter(Boolean)
    if (miss?.length)
        throw new ApiError(HTTP_FAILED_DEPENDENCY, miss)
}
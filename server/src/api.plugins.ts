import {
    AvailablePlugin,
    enablePlugins,
    getAvailablePlugins,
    getPluginConfigFields,
    mapPlugins,
    Plugin, pluginsConfig
} from './plugins'
import _ from 'lodash'
import assert from 'assert'
import { objSameKeys, same } from './misc'
import { ApiHandlers, sendList } from './apiMiddleware'

const apis: ApiHandlers = {
    get_plugins({}, ctx) {
        const list = sendList([ ...mapPlugins(serialize), ...getAvailablePlugins() ])
        return list.events(ctx, {
            pluginInstalled: p => list.add(serialize(p)),
            'pluginStarted pluginStopped': p => {
                const { id, ...rest } = serialize(p)
                list.update({ id }, rest)
            },
            pluginUninstalled: id => list.remove({ id }),
        })

        function serialize(p: Readonly<Plugin> | AvailablePlugin) {
            return Object.assign('getData' in p ? p.getData() : p, { started: null }, _.pick(p, ['id','started']))
        }
    },

    async set_plugin({ id, enabled, config }) {
        assert(id, 'id')
        if (enabled !== undefined)
            enablePlugins.set( arr =>
                arr.includes(id) === enabled ? arr
                    : enabled ? [...arr, id]
                        : arr.filter((x: string) => x !== id)
            )
        if (config) {
            const fields = getPluginConfigFields(id)
            config = _.pickBy(config, (v, k) =>
                v !== null && !same(v, fields?.[k]?.defaultValue))
            if (_.isEmpty(config))
                config = undefined
            pluginsConfig.set(v => ({ ...v, [id]: config }))
        }
        return {}
    },

    async get_plugin({ id }) {
        return {
            enabled: enablePlugins.get().includes(id),
            config: {
                ...objSameKeys(getPluginConfigFields(id) ||{}, v => v?.defaultValue),
                ...pluginsConfig.get()[id]
            }
        }
    },

}

export default apis

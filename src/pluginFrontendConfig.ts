import Koa from 'koa'
import _ from 'lodash'
import { enforceStarting, newObj } from './misc'
import { getPluginConfigFields, getPluginInfo, pluginsConfig } from './plugins'

export function getPluginFrontendConfig(id: string, ctx: Koa.Context) {
    let config = newObj(getPluginConfigFields(id), (field, key, skip) =>
        !field.frontend ? skip() : adjustValueByConfig(pluginsConfig.get()?.[id]?.[key], field))
    config = getPluginInfo(id)?.onFrontendConfig?.(config) || config
    return config

    function adjustValueByConfig(value: any, field: any): any {
        value ??= field.defaultValue
        if (value && field.type === 'vfs_path') {
            value = enforceStarting('/', value)
            const { root } = ctx.state
            if (root) {
                if (!value.startsWith(root)) return
                value = value.slice(root.length - 1)
            }
            if (ctx.state.revProxyPath)
                value = ctx.state.revProxyPath + value
        }
        else if (field.type === 'array' && Array.isArray(value))
            value = value.map(item => _.mapValues(item,
                (nestedValue, nestedKey) => adjustValueByConfig(nestedValue, field.fields[nestedKey])))
        return value
    }
}

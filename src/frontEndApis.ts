import { ApiHandlers } from './apis'
import { mapPlugins } from './plugins'
import { PLUGINS_PUB_URI } from './const'
import * as api_file_list from './api.file_list'
import * as api_auth from './api.auth'
import { setConfig } from './config'

export const frontEndApis: ApiHandlers = {

    ...api_file_list,

    ...api_auth,

    async extras_to_load() {
        const css = mapPlugins((plug,k) =>
            plug.frontend_css?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
        const js = mapPlugins((plug,k) =>
            plug.frontend_js?.map(f => PLUGINS_PUB_URI + k + '/' + f)).flat().filter(Boolean)
        return { css, js }
    },

    async config({ values }, ctx) {
        if (isLocalhost(ctx.ip))
            setConfig(values)
    },

}

function isLocalhost(ip: string) {
    return ip === '127.0.0.1' || ip === '::1'
}

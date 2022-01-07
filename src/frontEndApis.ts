import { ApiHandlers } from './apis'
import { plugins } from './plugins'
import { PLUGINS_PUB_URI } from './const'
import * as api_file_list from './api.file_list'
import * as api_auth from './api.auth'

export const frontEndApis: ApiHandlers = {

    ...api_file_list,

    ...api_auth,

    async extras_to_load() {
        const css = []
        for (const [k,plug] of Object.entries(plugins))
            if (plug.frontend_css)
                css.push( ...plug.frontend_css.map(f => PLUGINS_PUB_URI + k + '/' + f) )
        return { css }
    },

}

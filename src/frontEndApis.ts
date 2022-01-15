import { ApiHandlers } from './apis'
import * as api_file_list from './api.file_list'
import * as api_auth from './api.auth'
import { setConfig } from './config'

export const frontEndApis: ApiHandlers = {

    ...api_file_list,

    ...api_auth,

    async config({ values }, ctx) {
        if (isLocalhost(ctx.ip))
            setConfig(values)
    },

}

function isLocalhost(ip: string) {
    return ip === '127.0.0.1' || ip === '::1'
}

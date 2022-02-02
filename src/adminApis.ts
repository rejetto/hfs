import { ApiHandlers } from './apis'
import { getWholeConfig, setConfig } from './config'
import { getStatus } from './listen'
import { HFS_STARTED } from './index'
import { Server } from 'http'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,

    async set_config({ values }) {
        if (values)
            setConfig(values, true)
        return {}
    },

    get_config(params) {
        return getWholeConfig(params)
    },

    async get_status() {
        const st = getStatus()
        return {
            started: HFS_STARTED,
            http: serverStatus(st.httpSrv),
            https: serverStatus(st.httpsSrv),
        }

        function serverStatus(h: Server) {
            return {
                active: h.listening,
                port: getPort(h),
            }
        }

        function getPort(srv: Server) {
            return (srv.address() as any)?.port
        }
    },

}

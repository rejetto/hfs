import { ApiHandlers } from './apis'
import { getWholeConfig, setConfig } from './config'
import { getStatus } from './listen'
import { app, HFS_STARTED } from './index'
import { Server } from 'http'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import { Connection, getConnections } from './connections'
import { generatorAsCallback, onOffMap, pendingPromise } from './misc'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,

    async set_config({ values }) {
        if (values)
            await setConfig(values)
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
                port: (h.address() as any)?.port,
            }
        }
    },

    async disconnect({ ip, port, wait }) {
        const c = getConnections().find(({ socket }) =>
            port === socket.remotePort && ip === socket.remoteAddress )
        const waiter = pendingPromise<void>()
        c?.socket.end(waiter.resolve)
        if (wait)
            await waiter
        return { result: Boolean(c) }
    },

    async *get_connections({}, ctx) {
        for (const conn of getConnections())
            yield { add: serializeConnection(conn) }
        yield* generatorAsCallback(wrapper =>
            ctx.res.once('close', // as connection is closed, call the callback returned by onOffMap that uninstalls the listener
                onOffMap(app, {
                    connection: conn => wrapper.callback({ add: serializeConnection(conn) }),
                    connectionClosed(conn: Connection) {
                        wrapper.callback({ remove: [ serializeConnection(conn, true) ] })
                    },
                    connectionUpdated(conn: Connection, change: Partial<Connection>) {
                        wrapper.callback({ update: [{ search: serializeConnection(conn, true), change }] })
                    },
                })
            ) )

        function serializeConnection(conn: Connection, minimal?:true) {
            const { socket, started, secure, got } = conn
            return {
                v: minimal ? undefined : (socket.remoteFamily?.endsWith('6') ? 6 : 4),
                port: socket.remotePort,
                ip: socket.remoteAddress,
                got: minimal ? undefined : got,
                started: minimal ? undefined : started,
                secure: minimal ? undefined : (secure || undefined), // undefined will save some space once json-ed
            }

        }
    }

}

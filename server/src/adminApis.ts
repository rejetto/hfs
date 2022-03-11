// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { getConfig, getWholeConfig, setConfig } from './config'
import { getStatus } from './listen'
import { BUILD_TIMESTAMP, HFS_STARTED, VERSION } from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import { Connection, getConnections } from './connections'
import { generatorAsCallback, onOffMap, pendingPromise } from './misc'
import _ from 'lodash'
import events from './events'
import { getAccounts, getFromAccount } from './perm'
import Koa from 'koa'

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
            build: BUILD_TIMESTAMP,
            version: VERSION,
            http: serverStatus(st.httpSrv, getConfig('port')),
            https: serverStatus(st.httpsSrv, getConfig('https_port')),
        }

        function serverStatus(h: typeof st.httpSrv, configuredPort?: number) {
            return {
                ..._.pick(h, ['listening', 'busy', 'error']),
                port: (h?.address() as any)?.port || configuredPort,
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
                onOffMap(events, {
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
            const { socket, started, secure, got, path } = conn
            return {
                port: socket.remotePort,
                ip: socket.remoteAddress,
                ...!minimal && {
                    v: (socket.remoteFamily?.endsWith('6') ? 6 : 4),
                    got,
                    started,
                    path,
                    secure: (secure || undefined), // undefined will save some space once json-ed
                }
            }
        }
    }

}

for (const k in adminApis) {
    const was = adminApis[k]
    adminApis[k] = (params, ctx) =>
        ctxAdminAccess(ctx) ? was(params, ctx)
            : new ApiError(401)
}

export function ctxAdminAccess(ctx: Koa.Context) {
    return ctx.ip === '127.0.0.1'
        || getFromAccount(ctx.state.account, a => a.admin)
}

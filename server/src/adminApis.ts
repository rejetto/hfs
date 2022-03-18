// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { getConfig, getWholeConfig, setConfig } from './config'
import { getStatus, getUrls } from './listen'
import { BUILD_TIMESTAMP, FORBIDDEN, HFS_STARTED, VERSION } from './const'
import vfsApis from './api.vfs'
import accountsApis from './api.accounts'
import { Connection, getConnections } from './connections'
import { onOffMap, pendingPromise } from './misc'
import _ from 'lodash'
import events from './events'
import { getFromAccount } from './perm'
import Koa from 'koa'
import { Readable } from 'stream'

export const adminApis: ApiHandlers = {

    ...vfsApis,
    ...accountsApis,

    async set_config({ values: v }) {
        if (v) {
            const st = getStatus()
            const noHttp = (v.port ?? getConfig('port')) < 0 || !st.httpSrv.listening
            const noHttps = (v.https_port ?? getConfig('https_port')) < 0 || !st.httpsSrv.listening
            if (noHttp && noHttps)
                return new ApiError(FORBIDDEN, "You cannot switch off both http and https ports")
            await setConfig(v)
        }
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
            urls: getUrls(),
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

    get_connections({}, ctx) {
        const ret = new Readable({ objectMode: true, read(){} }) // we don't care what you ask/read, we just push and hope for the best
        // start with existing connections
        for (const conn of getConnections())
            ret.push({ add: serializeConnection(conn) })
        // then send updates
        const off = onOffMap(events, {
            connection: conn => ret.push({ add: serializeConnection(conn) }),
            connectionClosed(conn: Connection) {
                ret.push({ remove: [ serializeConnection(conn, true) ] })
            },
            connectionUpdated(conn: Connection, change: Partial<Connection>) {
                ret.push({ update: [{ search: serializeConnection(conn, true), change }] })
            },
        })
        // we never close this stream ourselves, just when connection is closed we have to take care of listeners
        ctx.res.once('close', off)
        return ret

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

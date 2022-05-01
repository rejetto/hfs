import _ from 'lodash'
import { Connection, getConnections } from './connections'
import { pendingPromise } from './misc'
import { ApiHandlers, sendList } from './apiMiddleware'
import Koa from 'koa'

const apis: ApiHandlers = {

    async disconnect({ ip, port, wait }) {
        const match = _.matches({ ip, port })
        const c = getConnections().find(c => match(getConnAddress(c)))
        const waiter = pendingPromise<void>()
        c?.socket.end(waiter.resolve)
        if (wait)
            await waiter
        return { result: Boolean(c) }
    },

    get_connections({}, ctx) {
        const list = sendList( getConnections().map(c => serializeConnection(c)) )
        return list.events(ctx, {
            connection: conn => list.add(serializeConnection(conn)),
            connectionClosed(conn: Connection) {
                list.remove(serializeConnection(conn, true))
            },
            connectionUpdated(conn: Connection, change: Partial<Omit<Connection,'ip'>>) {
                if (change.ctx) {
                    Object.assign(change, fromCtx(change.ctx))
                    delete change.ctx
                }
                list.update(serializeConnection(conn, true), change)
            },
        })

        function serializeConnection(conn: Connection, minimal?:true) {
            const { socket, started, secure, got } = conn
            return Object.assign(getConnAddress(conn), !minimal && {
                v: (socket.remoteFamily?.endsWith('6') ? 6 : 4),
                got,
                started,
                secure: (secure || undefined) as boolean|undefined, // undefined will save some space once json-ed
                ...fromCtx(conn.ctx),
            })
        }

        function fromCtx(ctx?: Koa.Context) {
            return ctx && { path: ctx.fileSource && ctx.path } // only for downloading files
        }
    },

}

export default apis

function getConnAddress(conn: Connection) {
    return {
        ip: conn.ctx?.ip || conn.socket.remoteAddress,
        port: conn.socket.remotePort,
    }
}

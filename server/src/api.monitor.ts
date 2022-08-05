import _ from 'lodash'
import { Connection, getConnections } from './connections'
import { pendingPromise, wait } from './misc'
import { ApiHandlers, SendListReadable } from './apiMiddleware'
import Koa from 'koa'
import { totalGot, totalInSpeed, totalOutSpeed, totalSent } from './throttler'

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
        const list = new SendListReadable( getConnections().map(c => serializeConnection(c)) )
        type Change = Partial<Omit<Connection,'ip'>>
        const throttledUpdate = _.throttle(update, 1000/20) // try to avoid clogging with updates
        return list.events(ctx, {
            connection: conn => list.add(serializeConnection(conn)),
            connectionClosed(conn: Connection) {
                list.remove(serializeConnection(conn, true))
            },
            connectionUpdated(conn: Connection, change: Change) {
                if (!change.ctx)
                    return throttledUpdate(conn, change)
                Object.assign(change, fromCtx(change.ctx))
                delete change.ctx
                throttledUpdate(conn, change)
            },
        })

        function update(conn: Connection, change: Change) {
            list.update(serializeConnection(conn, true), change)
        }

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
            return ctx && {
                archive: ctx.state.archive,
                path: (ctx.fileSource || ctx.state.archive) && ctx.path  // only for downloading files
            }
        }
    },

    async *get_connection_stats() {
        while (1) {
            yield {
                outSpeed: totalOutSpeed,
                inSpeed: totalInSpeed,
                got: totalGot,
                sent: totalSent,
                connections: getConnections().length
            }
            await wait(1000)
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

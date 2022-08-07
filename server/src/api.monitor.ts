import _ from 'lodash'
import { Connection, getConnections } from './connections'
import { pendingPromise, wait } from './misc'
import { ApiHandlers, SendListReadable } from './apiMiddleware'
import Koa from 'koa'
import { totalGot, totalInSpeed, totalOutSpeed, totalSent } from './throttler'
import { getCurrentUsername } from './perm'

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
        const state = Symbol('state') // undefined=added, Timeout=add-pending, false=removed
        return list.events(ctx, {
            connection(conn: Connection) {
                conn[state] = setTimeout(() => add(conn), 100)
            },
            connectionClosed(conn: Connection) {
                if (cancel(conn)) return
                list.remove(serializeConnection(conn, true))
                conn[state] = false
            },
            connectionUpdated(conn: Connection, change: Change) {
                if (!change.ctx)
                    return throttledUpdate(conn, change)

                Object.assign(change, fromCtx(change.ctx))
                change.ctx = undefined
                if (!add(conn))
                    throttledUpdate(conn, change)
            },
        })

        function add(conn: Connection) {
            if (!cancel(conn)) return
            list.add(serializeConnection(conn))
            return true
        }

        function cancel(conn: Connection) {
            if (!conn[state]) return
            clearTimeout(conn[state])
            conn[state] = undefined
            return true
        }

        function update(conn: Connection, change: Change) {
            if (conn[state] === false) return
            list.update(serializeConnection(conn, true), change)
        }

        function serializeConnection(conn: Connection, minimal?:true) {
            const { socket, started, secure } = conn
            return Object.assign(getConnAddress(conn), !minimal && {
                v: (socket.remoteFamily?.endsWith('6') ? 6 : 4),
                got: socket.bytesRead,
                sent: socket.bytesWritten,
                started,
                secure: (secure || undefined) as boolean|undefined, // undefined will save some space once json-ed
                ...fromCtx(conn.ctx),
            })
        }

        function fromCtx(ctx?: Koa.Context) {
            return ctx && {
                user: getCurrentUsername(ctx),
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

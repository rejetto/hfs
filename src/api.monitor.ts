// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import _ from 'lodash'
import { Connection, getConnections } from './connections'
import { shortenAgent, wait } from './misc'
import { ApiHandlers } from './apiMiddleware'
import Koa from 'koa'
import { totalGot, totalInSpeed, totalOutSpeed, totalSent } from './throttler'
import { getCurrentUsername } from './auth'
import { SendListReadable } from './SendList'

export default {

    async disconnect({ ip, port }) {
        const match = _.matches({ ip, port })
        const found = getConnections().filter(c => match(getConnAddress(c)))
        for (const c of found)
            c.socket.destroy()
        return { result: found.length }
    },

    get_connections({}, ctx) {
        const list = new SendListReadable({
            diff: true,
            addAtStart: getConnections().map(c =>
                !ignore(c) && serializeConnection(c)).filter(Boolean),
        })
        type Change = Partial<Omit<Connection,'ip'>>
        list.props({ you: ctx.ip })
        return list.events(ctx, {
            connection(conn: Connection) {
                if (ignore(conn)) return
                list.add(serializeConnection(conn))
            },
            connectionClosed(conn: Connection) {
                if (ignore(conn)) return
                list.remove(getConnAddress(conn))
            },
            connectionUpdated(conn: Connection, change: Change) {
                if (conn.socket.closed || ignore(conn) || ignore(change as any) || _.isEmpty(change)) return
                if (change.ctx) {
                    Object.assign(change, fromCtx(change.ctx))
                    change.ctx = undefined
                }
                list.update(getConnAddress(conn), change)
            },
        })

        function serializeConnection(conn: Connection) {
            const { socket, started, secure } = conn
            return {
                ...getConnAddress(conn),
                v: (socket.remoteFamily?.endsWith('6') ? 6 : 4),
                got: socket.bytesRead,
                sent: socket.bytesWritten,
                country: conn.country,
                started,
                secure: (secure || undefined) as boolean|undefined, // undefined will save some space once json-ed
                ...fromCtx(conn.ctx),
            }
        }

        function fromCtx(ctx?: Koa.Context) {
            if (!ctx) return
            const s = ctx.state // short alias
            return {
                user: getCurrentUsername(ctx),
                agent: shortenAgent(ctx.get('user-agent')),
                archive: s.archive,
                ...s.browsing ? { op: 'browsing', path: decodeURIComponent(s.browsing) }
                    : s.uploadPath ? { op: 'upload',path: decodeURIComponent(s.uploadPath) }
                        : {
                            op: !s.considerAsGui && s.op || undefined,
                            path: decodeURIComponent(ctx.originalUrl)
                        },
                opProgress: _.isNumber(s.opProgress) ? _.round(s.opProgress, 3) : undefined,
                opTotal: s.opTotal,
                opOffset: s.opOffset,
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
                connections: _.sumBy(getConnections(), x => ignore(x) ? 0 : 1),
            }
            await wait(1000)
        }
    },
} satisfies ApiHandlers

function ignore(conn: Connection) {
    return false //conn.socket && isLocalHost(conn)
}

function getConnAddress(conn: Connection) {
    return {
        ip: conn.ip,
        port: conn.socket.remotePort,
    }
}

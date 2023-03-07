// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

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
        if (c) {
            const waiter = pendingPromise<void>()
            c.socket.end(waiter.resolve)
            c.ctx?.res.end()
            c.ctx?.req.socket.end('')
            if (wait)
                await waiter
        }
        return { result: Boolean(c) }
    },

    get_connections({}, ctx) {
        const list = new SendListReadable({ addAtStart: getConnections().map(c => serializeConnection(c)) })
        type Change = Partial<Omit<Connection,'ip'>>
        const throttledUpdate = _.throttle(update, 1000/20) // try to avoid clogging with updates
        const state = Symbol('state') // undefined=added, Timeout=add-pending, false=removed
        list.props({ you: ctx.ip })
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
                agent: getBrowser(ctx.get('user-agent')),
                archive: ctx.state.archive,
                upload: ctx.state.uploadProgress,
                path: ctx.state.uploadPath
                    || (ctx.fileSource || ctx.state.archive) && ctx.path  // only uploads and downloads
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
        ip: conn.ip,
        port: conn.socket.remotePort,
    }
}

function getBrowser(agent: string) {
    for (const [name,re] of Object.entries(BROWSERS))
        if (re.test(agent))
            return name
    return ''
}
const BROWSERS = {
    YaBrowser: /yabrowser/i,
    AlamoFire: /alamofire/i,
    Edge: /edge|edga|edgios|edg/i,
    PhantomJS: /phantomjs/i,
    Konqueror: /konqueror/i,
    Amaya: /amaya/i,
    Epiphany: /epiphany/i,
    SeaMonkey: /seamonkey/i,
    Flock: /flock/i,
    OmniWeb: /omniweb/i,
    Opera: /opera|OPR\//i,
    Chromium: /chromium/i,
    Facebook: /FBA[NV]/,
    Chrome: /chrome|crios/i,
    WinJs: /msapphost/i,
    IE: /msie|trident/i,
    Firefox: /firefox|fxios/i,
    Safari: /safari/i,
    PS5: /playstation 5/i,
    PS4: /playstation 4/i,
    PS3: /playstation 3/i,
    PSP: /playstation portable/i,
    PS: /playstation/i,
    Xbox: /xbox/i,
    UC: /UCBrowser/i,
}
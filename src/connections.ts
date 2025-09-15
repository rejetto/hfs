// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Socket } from 'net'
import events from './events'
import { Context } from 'koa'
import { ip2country } from './geo'
import _ from 'lodash'

export class Connection {
    readonly started = new Date()
    sent = 0 // socket-scoped, not request-scoped
    got = 0
    outSpeed?: number
    inSpeed?: number
    ctx?: Context // this is set externally, during koa middleware, using updateConnectionForCtx, but only for regular requests; some connections may never have a ctx
    country?: string
    private _cachedIp?: string
    [rest:symbol]: any // let other modules add extra data, but using symbols to avoid name collision

    // the sockets we collect are the plain ones, as soon as the tcp layer is connected
    constructor(public readonly socket: Socket) {
        all.push(this)
        socket.on('close', () => {
            all.splice(all.indexOf(this), 1)
            events.emit('connectionClosed', this)
        })
        events.emit('connection', this)
    }

    get ip() { // prioritize ctx.ip as it supports proxies, but fallback for when ctx is not yet available
        if (this._cachedIp && this.ctx && this._cachedIp !== this.ctx.ip) {
            events.emit('connectionNewIp', this, this._cachedIp, this.ctx.ip)
            this._cachedIp = undefined
        }
        return this.ctx?.ip || (this._cachedIp ??= normalizeIp(this.socket.remoteAddress||''))
    }

    get secure() {
        return (this.socket as any).server.cert > ''
    }
}

export function normalizeIp(ip: string) {
    return ip.replace(/^::ffff:/,'') // simplify ipv6-mapped addresses
}

const all: Connection[] = []

export function newConnection(socket: Socket) {
    const ip = normalizeIp(socket.remoteAddress || '')
    const res = events.emit('newSocket', { socket, ip })
    const msg = res?.isDefaultPrevented() ? 'plugin (newSocket)' : res?.find(_.isString)
    if (!msg)
        return new Connection(socket)
    disconnect(socket, msg)
}

export function getConnections(): Readonly<typeof all> {
    return all
}

export function socket2connection(socket: Socket) {
    return all.find(x => // socket exposed by Koa is TLSSocket which encapsulates simple Socket, and I've found no way to access it for simple comparison
        x.socket.remotePort === socket.remotePort // but we can still match them because IP:PORT is key
        && x.socket.remoteAddress === socket.remoteAddress )
}

export function getConnection(ctx: Context) {
    return ctx.state.connection
}

export function updateConnectionForCtx(ctx: Context) {
    const conn = getConnection(ctx)
    if (conn)
        updateConnection(conn, { ctx })
    return conn
}

export function updateConnection(conn: Connection, change: Partial<Connection>, changeState?: true | Partial<Context['state']>) {
    const { ctx } = conn
    if (changeState && ctx) {
        Object.assign(ctx.state, changeState)
        Object.assign(change, { ctx })
    }
    Object.assign(conn, change)
    events.emit('connectionUpdated', conn, change)
}

export const disconnectionsLog: { ts: Date, ip: string, country?: string, msg?: string }[] = []

export function disconnect(what: Context | Socket | Connection, logMessage='') {
    if ('socket' in what)
        what = what.socket
    const ip = normalizeIp(what.remoteAddress || '')
    if (logMessage)
        console.debug("disconnection:", logMessage, ip)
    ip2country(ip).then(res => {
        const rec = { ip, country: res || undefined, ts: new Date, msg: logMessage || undefined }
        disconnectionsLog.unshift(rec)
        disconnectionsLog.length = Math.min(1000, disconnectionsLog.length)
        events.emit('disconnection', rec)
    })
    return what.destroy()
}


declare module "koa" {
    interface BaseContext {
        isAborted(): boolean
        disconnect(logMessage?: string): unknown
    }
}
events.once('app', app => { // can't simply import 'app', as it's not defined at this point (this file is required by 'plugins.ts' which is required by 'index.ts')
    app.context.isAborted = function() {
        return this.res.destroyed || this.req.aborted // investigate: "aborted" is deprecated, but "destroyed" will cause failure of some tests
            || this.socket.destroyed
    }
    app.context.disconnect = function(logMessage='') {
        return disconnect(this as Context, logMessage)
    }
})
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Readable } from 'stream'
import Koa from 'koa'
import { ThrottledStream, ThrottleGroup } from './ThrottledStream'
import { defineConfig } from './config'
import { getOrSet, isLocalHost } from './misc'
import { Connection, getConnection, updateConnection } from './connections'
import _ from 'lodash'
import events from './events'
import { storedMap } from './persistence'

const mainThrottleGroup = new ThrottleGroup(Infinity)

defineConfig('max_kbps', Infinity).sub(v =>
    mainThrottleGroup.updateLimit(v))

const ip2group: Record<string, {
    count: number
    group: ThrottleGroup
}> = {}

const SymThrStr = Symbol('stream')
const SymTimeout = Symbol('timeout')

const maxKbpsPerIp = defineConfig('max_kbps_per_ip', Infinity)
maxKbpsPerIp.sub(v => {
    for (const [ip, {group}] of Object.entries(ip2group))
        if (ip) // empty-string = unlimited group
            group.updateLimit(v)
})

export const throttler: Koa.Middleware = async (ctx, next) => {
    await next()
    let { body } = ctx
    const downloadTotal: number = ctx.response.length
    if (typeof body === 'string' || body && body instanceof Buffer)
        ctx.body = body = Readable.from(body)
    if (!body || !(body instanceof Readable))
        return
    // we wrap the stream also for unlimited connections to get speed and other features
    const noLimit = ctx.state.account?.ignore_limits || isLocalHost(ctx)
    const ipGroup = getOrSet(ip2group, noLimit ? '' : ctx.ip, () => ({
        count:0,
        group: new ThrottleGroup(noLimit ? Infinity : maxKbpsPerIp.get(), noLimit ? undefined : mainThrottleGroup),
    }))
    const conn = getConnection(ctx)
    if (!conn) throw 'assert throttler connection'

    const ts = conn[SymThrStr] = new ThrottledStream(ipGroup.group, conn[SymThrStr])
    const offset = ts.getBytesSent()
    let closed = false

    const DELAY = 1000
    const update = _.debounce(() => {
        const ts = conn[SymThrStr] as ThrottledStream
        const outSpeed = roundSpeed(ts.getSpeed())
        const { state } = ctx
        updateConnection(conn, { outSpeed, sent: conn.socket.bytesWritten },
            { opProgress: state.opTotal && ((state.opOffset || 0) + (ts.getBytesSent() - offset) / state.opTotal) })
        /* in case this stream stands still for a while (before the end), we'll have neither 'sent' or 'close' events,
        * so who will take care to updateConnection? This artificial next-call will ensure just that */
        clearTimeout(conn[SymTimeout])
        if (outSpeed || !closed)
            conn[SymTimeout] = setTimeout(update, DELAY)
    }, DELAY, { leading: true, maxWait:DELAY })
    ts.on('sent', (n: number) => {
        totalSent.set(x => (x || 0) + n)
        update()
    })

    ++ipGroup.count
    ts.on('close', ()=> {
        update.flush()
        closed = true
        if (--ipGroup.count) return // any left?
        delete ip2group[ctx.ip]
    })

    ctx.state.originalStream = body
    ctx.body = body.pipe(ts)

    if (downloadTotal !== undefined) // undefined will break SSE
        ctx.response.length = downloadTotal // preserve this info
    ts.once('close', () => // in case of compressed response, we offer calculation of real size
        ctx.state.length = ts.getBytesSent() - offset)
}

declare module "koa" {
    interface DefaultState {
        length?: number
        originalStream?: Parameters<Koa.Middleware>[0]['body']
    }
}

export function roundSpeed(n: number) {
    return _.round(n, 1) || _.round(n, 3) // further precision if necessary
}

export let totalSent = storedMap.singleSync<number>('totalSent', 0)
export let totalGot = storedMap.singleSync<number>('totalGot', 0)
export let totalOutSpeed = 0
export let totalInSpeed = 0

let lastSent: number | undefined
let lastGot: number | undefined
let last = Date.now()
setInterval(() => {
    const now = Date.now()
    const past = now - last
    last = now
    {
        const v = totalSent.get()
        totalOutSpeed = roundSpeed((v - (lastSent ?? v)) / past)
        lastSent = v
    }
    {
        const v = totalGot.get()
        totalInSpeed = roundSpeed((v - (lastGot ?? v)) / past)
        lastGot = v
    }
}, 1000)

events.on('connection', (c: Connection) =>
    c.socket.on('data', data =>
        totalGot.set(x => (x || 0) + data.length) ))

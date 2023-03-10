// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Readable } from 'stream'
import Koa from 'koa'
import { ThrottledStream, ThrottleGroup } from './ThrottledStream'
import { defineConfig } from './config'
import { getOrSet, isLocalHost } from './misc'
import { Connection, updateConnection } from './connections'
import _ from 'lodash'
import events from './events'

const mainThrottleGroup = new ThrottleGroup(Infinity)

defineConfig('max_kbps', Infinity).sub(v =>
    mainThrottleGroup.updateLimit(v))

const ip2group: Record<string, {
    count: number
    group: ThrottleGroup
    destroy: () => void
}> = {}

const SymThrStr = Symbol('stream')
const SymTimeout = Symbol('timeout')

const maxKbpsPerIp = defineConfig('max_kbps_per_ip', Infinity)

export const throttler: Koa.Middleware = async (ctx, next) => {
    await next()
    const { body } = ctx
    if (!body || !(body instanceof Readable))
        return
    // we wrap the stream also for unlimited connections to get speed and other features
    const ipGroup = getOrSet(ip2group, ctx.ip, ()=> {
        const doLimit = ctx.state.account?.ignore_limits || isLocalHost(ctx) ? undefined : true
        const group = new ThrottleGroup(Infinity, doLimit && mainThrottleGroup)

        const unsub = doLimit && maxKbpsPerIp.sub(v =>
            group.updateLimit(v))
        return { group, count:0, destroy: unsub }
    })
    const conn = ctx.state.connection as Connection | undefined
    if (!conn) throw 'assert throttler connection'

    const ts = conn[SymThrStr] = new ThrottledStream(ipGroup.group, conn[SymThrStr])
    let closed = false

    const DELAY = 1000
    const update = _.debounce(() => {
        const ts = conn[SymThrStr] as ThrottledStream
        const outSpeed = roundSpeed(ts.getSpeed())
        updateConnection(conn, { outSpeed, sent: ts.getBytesSent() })
        /* in case this stream stands still for a while (before the end), we'll have neither 'sent' or 'close' events,
        * so who will take care to updateConnection? This artificial next-call will ensure just that */
        clearTimeout(conn[SymTimeout])
        if (outSpeed || !closed)
            conn[SymTimeout] = setTimeout(update, DELAY)
    }, DELAY, { maxWait:DELAY })
    ts.on('sent', (n: number) => {
        totalSent += n
        update()
    })

    ++ipGroup.count
    ts.on('close', ()=> {
        update.flush()
        closed = true
        if (--ipGroup.count) return // any left?
        ipGroup.destroy?.()
        delete ip2group[ctx.ip]
    })

    const bak = ctx.response.length // preserve
    ctx.body = ctx.body.pipe(ts)

    if (bak)
        ctx.response.length = bak
    ts.once('end', () => // in case of compressed response, we offer calculation of real size
        ctx.state.length = ts.getBytesSent())
}

export function roundSpeed(n: number) {
    return _.round(n, 1) || _.round(n, 3) // further precision if necessary
}

export let totalSent = 0
export let totalGot = 0
export let totalOutSpeed = 0
export let totalInSpeed = 0

let lastSent = totalSent
let lastGot = totalGot
let last = Date.now()
setInterval(() => {
    const now = Date.now()
    const past = (now - last) / 1000 // seconds
    last = now
    const deltaSentKb = (totalSent - lastSent) / 1000
    lastSent = totalSent
    const deltaGotKb = (totalGot - lastGot) / 1000
    lastGot = totalGot
    totalOutSpeed = roundSpeed(deltaSentKb / past)
    totalInSpeed = roundSpeed(deltaGotKb / past)
}, 1000)

events.on('connection', (c: Connection) =>
    c.socket.on('data', data =>
        totalGot += data.length ))

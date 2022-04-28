// This file is part of HFS - Copyright 2021-2022, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Readable } from 'stream'
import Koa from 'koa'
import { ThrottledStream, ThrottleGroup } from './ThrottledStream'
import { defineConfig } from './config'
import { getOrSet, isLocalHost } from './misc'
import { updateConnection } from './connections'
import _ from 'lodash'

const mainThrottleGroup = new ThrottleGroup(Infinity)

defineConfig('max_kbps', null).sub(v =>
    mainThrottleGroup.updateLimit(v ?? Infinity))

const ip2group: Record<string, {
    count: number
    group: ThrottleGroup
    destroy: () => void
}> = {}

const SymThrStr = Symbol('stream')
const SymTimeout = Symbol('timeout')

const maxKbpsPerIp = defineConfig('max_kbps_per_ip', null)

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
            group.updateLimit(v ?? Infinity))
        return { group, count:0, destroy: unsub }
    })
    const conn = ctx.state.connection
    if (!conn) throw 'assert throttler connection'

    const ts = conn[SymThrStr] = new ThrottledStream(ipGroup.group, conn[SymThrStr])

    const DELAY = 1000
    const update = _.debounce(() => {
        const ts = conn[SymThrStr]
        const speed = ts.getSpeed()
        const outSpeed = _.round(speed, 1) || _.round(speed, 3) // further precision if necessary
        updateConnection(conn, { outSpeed, sent: ts.getBytesSent() })
        clearTimeout(conn[SymTimeout])
        if (outSpeed || !(ts.finished || ts.ended))
            conn[SymTimeout] = setTimeout(update, DELAY)
    }, DELAY, { maxWait:DELAY })
    ts.on('sent', update)

    ++ipGroup.count
    ts.on('close', ()=> {
        update.flush()
        if (--ipGroup.count) return // any left?
        ipGroup.destroy?.()
        delete ip2group[ctx.ip]
    })

    const bak = ctx.response.length // preserve
    ctx.body = ctx.body.pipe(ts)

    if (bak)
        ctx.response.length = bak
}

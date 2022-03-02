import { Readable } from 'stream'
import Koa from 'koa'
import { ThrottledStream, ThrottleGroup } from './ThrottledStream'
import { subscribeConfig } from './config'
import { getOrSet } from './misc'
import { socket2connection, updateConnection } from './connections'
import _ from 'lodash'

const mainThrottleGroup = new ThrottleGroup(Infinity)

subscribeConfig({ k:'max_kbps', defaultValue:null }, v =>
    mainThrottleGroup.updateLimit(v ?? Infinity))

const ip2group: Record<string, {
    count: number
    group: ThrottleGroup
    destroy: () => void
}> = {}

const SymThrStr = Symbol('stream')
const SymTimeout = Symbol('timeout')

export function throttler(): Koa.Middleware {
    return async (ctx, next) => {
        await next()
        const { body } = ctx
        if (!body || !(body instanceof Readable) || ctx.state.account?.ignore_limits)
            return
        const ipGroup = getOrSet(ip2group, ctx.ip, ()=> {
            const tg = new ThrottleGroup(Infinity, mainThrottleGroup)
            const unsub = subscribeConfig({ k:'max_kbps_per_ip', defaultValue:null }, v =>
                tg.updateLimit(v ?? Infinity))
            return { group:tg, count:0, destroy: unsub }
        })
        const conn = socket2connection(ctx.socket)
        if (!conn) throw 'assert throttler connection'

        const ts = conn[SymThrStr] = new ThrottledStream(ipGroup.group, conn[SymThrStr])

        const DELAY = 1000
        const update = _.debounce(() => {
            const ts = conn[SymThrStr]
            const outSpeed = _.round(ts.getSpeed(), 1)
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
}

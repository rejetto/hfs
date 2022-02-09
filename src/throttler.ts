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

interface GroupThrottler { count:number, throttler:ThrottledStream, destroy:()=>void }
const ip2group: Record<string,GroupThrottler> = {}

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
            return { tg, count:0, destroy: unsub }
        })
        const ts = new ThrottledStream(ipGroup.tg)
        ++ipGroup.count
        ts.on('close', ()=> {
            if (--ipGroup.count) return // any left?
            ipGroup.destroy?.()
            delete ip2group[ctx.ip]
        })

        const conn = socket2connection(ctx.socket)
        if (conn)
            ts.on('sent', _.debounce(() =>
                updateConnection(conn, { sent: ts.getBytesSent(), outSpeed: _.round(ts.getSpeed(),1) }), 1000, { maxWait:1000 }))

        const bak = ctx.response.length // preserve
        ctx.body = ctx.body.pipe(ts)

        if (bak)
            ctx.response.length = bak
    }
}

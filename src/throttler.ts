import { Readable } from 'stream'
import Koa from 'koa'
import { ThrottledStream, ThrottleGroup } from './ThrottledStream'
import { subscribeConfig } from './config'
import { getOrSet } from './misc'

const mainThrottleGroup = new ThrottleGroup(Infinity)

subscribeConfig({ k:'max_kbps', defaultValue:Infinity }, v =>
    mainThrottleGroup.updateLimit(v))

interface GroupThrottler { count:number, throttler:ThrottledStream }
const ip2group: Record<string,GroupThrottler> = {}

export function throttler(): Koa.Middleware {
    return async (ctx, next) => {
        await next()
        const { body } = ctx
        if (!body || !(body instanceof Readable) || ctx.account?.ignore_limits)
            return
        const ipGroup = getOrSet(ip2group, ctx.ip, ()=> {
            const tg = new ThrottleGroup(Infinity, mainThrottleGroup)
            subscribeConfig({ k:'max_kbps_per_ip', defaultValue:Infinity }, v =>
                tg.updateLimit(v))
            return { tg, count:0 }
        })
        const ts = new ThrottledStream(ipGroup.tg)
        ts.on('close', ()=> {
            if (!--ipGroup.count) // any left?
                delete ip2group[ctx.ip]
        })
        const bak = ctx.response.length // preserve
        ctx.body = ctx.body.pipe(ts)
        if (bak)
            ctx.response.length = bak
    }
}

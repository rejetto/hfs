// This file is part of HFS - Copyright 2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { KvStorage } from '@rejetto/kvstorage'
import { Middleware } from 'koa'
import { CFG, isLocalHost, MINUTE } from './misc'
import { onProcessExit } from './first'

const trackIps = defineConfig(CFG.track_ips, true)
type IpRecord = {
    ts: Date
    country?: string
    served: number
    failed: number
}

export const ips = new KvStorage<IpRecord>({
    defaultPutDelay: MINUTE,
    maxPutDelay: 10 * MINUTE,
    maxPutDelayCreate: 0,
})
onProcessExit(() => ips.close())

export const trackIpsMw: Middleware = async (ctx, next) => {
    const tracking = ips.isOpen() && !isLocalHost(ctx)
    const ts = new Date
    const country = ctx.state.connection.country
    let failed = false
    // defer storage update until downstream middlewares have assigned status or thrown
    try {
        await next()
    }
    catch(e) {
        failed = true
        throw e
    }
    finally {
        if (tracking) {
            // keep the counter update here so failures from downstream middlewares are counted with the final status
            const was = ips.getSync(ctx.ip)
            void ips.put(ctx.ip, {
                ts,
                country,
                served: (was?.served || 0) + (failed || ctx.status >= 400 ? 0 : 1),
                failed: (was?.failed || 0) + (failed || ctx.status >= 400 ? 1 : 0),
            }).catch(e => console.error("Couldn't track IP", ctx.ip, String(e)))
        }
    }
}

trackIps.sub(v => {
    if (v)
        ips.open('ips.kv')
    else
        ips.close()
})

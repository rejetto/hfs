// This file is part of HFS - Copyright 2021, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { defineConfig } from './config'
import { KvStorage } from '@rejetto/kvstorage'
import { Middleware } from 'koa'
import { CFG, isLocalHost, MINUTE } from './misc'
import { onProcessExit } from './first'

const trackIps = defineConfig(CFG.track_ips, true)
export const ips = new KvStorage({
    defaultPutDelay: MINUTE,
    maxPutDelay: 10 * MINUTE,
    maxPutDelayCreate: 0,
})
onProcessExit(() => ips.flush())

export const trackIpsMw: Middleware = async (ctx, next) => {
    if (trackIps.get() && !isLocalHost(ctx))
        ips.put(ctx.ip, { ts: new Date, country: ctx.state.connection.country })
    await next()
}

trackIps.sub(v => {
    if (v)
        ips.open('ips.kv')
    else
        ips.close()
})

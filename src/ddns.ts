import { defineConfig } from './config'
import { CFG, HOUR, repeat, replace, splitAt } from './cross'
import _ from 'lodash'
import { httpWithBody } from './util-http'
import { isIPv4 } from 'node:net'
import { isIPv6 } from 'net'
import { VERSION } from './const'
import events from './events'
import { getPublicIps } from './nat'

// optionally you can append '>' and a regular expression to determine what body is considered successful
const dynamicDnsUrl = defineConfig(CFG.dynamic_dns_url, '')

// listening this event will trigger public-ips fetching
const EVENT = 'publicIpsChanged'
let stopFetching: any
let lastIps: any
events.onListeners(EVENT, cbs => {
    stopFetching?.()
    if (!cbs?.size()) return
    stopFetching = repeat(HOUR, async () => {
        const IPs = await getPublicIps()
        if (_.isEqual(lastIps, IPs)) return
        events.emit(EVENT, {
            IPs,
            IPX: IPs[0] || '',
            IP4: _.find(IPs, isIPv4) || '',
            IP6: _.find(IPs, isIPv6) || '',
        })
    })
})

export interface DynamicDnsResult { ts: string, error: string, url: string }
let stopEvent: any
dynamicDnsUrl.sub(v => {
    stopEvent?.()
    if (!v) return
    stopEvent = events.on(EVENT, async map => {
        const all: DynamicDnsResult[] = await Promise.all(v.split('\n').map(async line => {
            const [templateUrl, re] = splitAt('>', line)
            const url = replace(templateUrl, map, '$')
            const error = await httpWithBody(url, { httpThrow: false, headers: { 'User-Agent': "HFS/" + VERSION } }) // UA specified as requested by no-ip guidelines
                .then(async res => {
                    const str = String(res.body).trim()
                    return (re ? str.match(re) : res.ok) ? '' : (str || res.statusMessage)
                }, (err: any) => err.code || err.message || String(err) )
            return { ts: new Date().toJSON(), error, url }
        }))
        const best = _.find(all, 'error') || all[0] // the system is designed for just one result, and we give precedence to errors
        events.emit('dynamicDnsError', best)
        console.log('dynamic dns update', best?.error || 'ok')
    })
})

export async function* get_dynamic_dns_error() {
    while (1) {
        const res = await events.once('dynamicDnsError')
        yield res[0]
    }
}
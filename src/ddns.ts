import { defineConfig } from './config'
import { CFG, HOUR, repeat, replace, splitAt } from './cross'
import _ from 'lodash'
import { httpWithBody } from './util-http'
import { isIPv4 } from 'node:net'
import { isIPv6 } from 'net'
import { VERSION } from './const'
import events from './events'
import { getPublicIps } from './nat'
import { Readable } from 'node:stream'

// optionally you can append '>' and a regular expression to determine what body is considered successful
const dynamicDnsUrl = defineConfig(CFG.dynamic_dns_url, '')

// listening this event will trigger public-ips fetching
const EVENT = 'publicIpsChanged'
let stopFetching: any
let lastIPs: any
let lastMap: any
events.onListeners(EVENT, cbs => {
    stopFetching?.()
    if (!cbs?.size) return
    stopFetching = repeat(HOUR, async () => {
        const IPs = await getPublicIps()
        if (_.isEqual(lastIPs, IPs)) return
        lastIPs = IPs
        events.emit(EVENT, lastMap = {
            IPs,
            IPX: IPs[0] || '',
            IP4: _.find(IPs, isIPv4) || '',
            IP6: _.find(IPs, isIPv6) || '',
        })
    })
})

export interface DynamicDnsResult { ts: string, error: string, url: string }
let stopListening: any
let last: DynamicDnsResult | undefined
dynamicDnsUrl.sub(v => {
    stopListening?.()
    if (!v) return
    stopListening = events.on(EVENT, async () => {
        if (!lastMap) return // called at start once, before first getPublicIps. Just skip it
        const lines = dynamicDnsUrl.get()
        const all: DynamicDnsResult[] = await Promise.all(lines.split('\n').map(async line => {
            const [templateUrl, re] = splitAt('>', line)
            const url = replace(templateUrl, lastMap, '$')
            const error = await httpWithBody(url, { httpThrow: false, headers: { 'User-Agent': "HFS/" + VERSION } }) // UA specified as requested by no-ip guidelines
                .then(async res => {
                    const str = String(res.body).trim()
                    return (re ? str.match(re) : res.ok) ? '' : (str || res.statusMessage)
                }, (err: any) => err.code || err.message || String(err) )
            return { ts: new Date().toJSON(), error, url }
        }))
        last = _.find(all, 'error') || all[0] // the system is designed for just one result, and we give precedence to errors
        events.emit('dynamicDnsError', last)
        console.log('dynamic dns update', last?.error || 'ok')
    }, { callNow: true })
})

export async function get_dynamic_dns_error() {
    let unsub: any
    return new Readable({
        objectMode: true,
        async read() {
            if (unsub) return
            if (last)
                this.push(last) // start by sending current state
            unsub = events.on('dynamicDnsError', x => this.push(x)) // send updates, if any. This simplified way to manage the data stream is acceptable for this case of extremely low throughput
        },
        async destroy() {
            unsub()
            this.push(null)
        }
    })
}
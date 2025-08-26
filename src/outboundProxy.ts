import { defineConfig } from './config'
import { parse } from 'node:url'
import { httpStream, httpString } from './util-http'
import { reg } from './util-os'
import events from './events'
import { IS_WINDOWS } from './const'
import { CFG, prefix } from './cross'

const outboundProxy = defineConfig(CFG.outbound_proxy, '', v => {
    try {
        parse(v) // just validate
        httpStream.defaultProxy = v
        if (!v || process.env.HFS_SKIP_PROXY_TEST) return
        const test = 'https://google.com'
        httpString(test).catch(e =>
            console.error(`proxy failed for ${test} : ${e?.errors?.[0] || e}`)) // `.errors` in case of AggregateError
    }
    catch {
        console.warn("invalid URL", v)
        return ''
    }
})

events.once('configReady', async startedWithoutConfig => {
    if (!IS_WINDOWS || !startedWithoutConfig) return
    // try to read Windows system setting for proxy
    const out = await reg('query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings')
    if (!/ProxyEnable.+(\d)/.exec(out)?.[1]) return
    const read = /ProxyServer.+?([\d:.]+)/.exec(out)?.[1]
    if (!read) return
    // it can be like "IP:PORT" or "http=IP:PORT;https=IP:PORT;ftp=IP:PORT"
    const url = prefix('https://', /https=([\d:.]+)/.exec(out)?.[1]) // prefer https
        || prefix('http://', /http=([\d:.]+)/.exec(out)?.[1])
        || !read.includes('=') && 'http://' + read // simpler form
    if (!url) return
    outboundProxy.set(url)
    console.log("detected proxy", read)
})
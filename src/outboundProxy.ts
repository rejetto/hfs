import { defineConfig } from './config'
import { parse } from 'node:url'
import { httpStream } from './util-http'
import { reg } from './util-os'
import events from './events'
import { IS_WINDOWS } from './const'
import { prefix } from './cross'

// don't move this in util-http, where it would mostly belong, as a require to config.ts would prevent tests using util-http
const outboundProxy = defineConfig('outbound_proxy', '', v => {
    try {
        parse(v)
        httpStream.defaultProxy = v
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
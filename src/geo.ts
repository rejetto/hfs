import { defineConfig } from './config'
import { CFG, DAY, httpStream, isIpLan, isLocalHost, makeNetMatcher, statWithTimeout, unzip } from './misc'
import { rename } from 'node:fs/promises'
import { IP2Location } from 'ip2location-nodejs'
import _ from 'lodash'
import { Middleware } from 'koa'
import { disconnect, updateConnection } from './connections'

const ip2location = new IP2Location()
const enabled = defineConfig(CFG.geo_enable, false)
const allow = defineConfig<boolean | null>(CFG.geo_allow, null)
const list = defineConfig(CFG.geo_list, [] as string[])
const allowUnknown = defineConfig(CFG.geo_allow_unknown, false)
const ignoreNet = defineConfig(CFG.geo_ignore_net, '', v => makeNetMatcher(v))
let filesCheck = Promise.resolve()
enabled.sub(() => {
    filesCheck = checkFiles().catch((e: any) =>
        console.error('Failed to load geo-ip db:', e?.message || String(e)))
})
setInterval(checkFiles, DAY) // keep updated at run-time

const cache = new Map<string, Promise<string>>()
// memoizing the promise lets simultaneous requests for one IP share a database read
export const ip2country = _.memoize((ip: string) => {
    if (cache.size > 1000)
        cache.delete(cache.keys().next().value!)
    return ip2location.getCountryShortAsync(ip).then(res => /^[A-Z]{2}$/.test(res) ? res : '', () => '') // result may be an error, but 2 letters is for countries
})
ip2country.cache = cache

export const geoFilter: Middleware = async (ctx, next) => {
    const shouldClassify = enabled.get() && !isLocalHost(ctx) && !isIpLan(ctx.ip) && !ignoreNet.compiled()(ctx.ip)
    if (shouldClassify && !isOpen())
        await filesCheck // allow database startup before applying the unknown-country policy
    // a reverse proxy can use one upstream socket for different client IPs
    const country = shouldClassify && isOpen() ? await ip2country(ctx.ip) : ''
    const { connection } = ctx.state
    if (country)
        ctx.state.geoCountry = country // don't store this info in the connection, as it may be shared between different clients if there's a proxy
    if ((connection.country || '') !== country)
        updateConnection(connection, { country })
    if (shouldClassify && !ctx.state.skipFilters && allow.get() !== null)
        if (country ? list.get().includes(country) !== allow.get() : !allowUnknown.get())
            return disconnect(ctx, 'geo-filter')
    await next()
}

function isOpen() {
    return Boolean(ip2location.getPackageVersion())
}

async function checkFiles() {
    if (!enabled.get()) return
    const BIN_FILE = 'IP2LOCATION-LITE-DB1.IPV6.BIN'
    const URL = `https://download.ip2location.com/lite/${BIN_FILE}.ZIP`
    const LOCAL_FILE = 'geo_ip.bin'
    const TEMP = LOCAL_FILE + '.downloading'
    const { mtime=0 } = await statWithTimeout(LOCAL_FILE).catch(() => ({ mtime: 0 }))
    const name = 'geo-ip db'
    const now = Date.now()
    if (+mtime < now - 31 * DAY) // month-old or non-existing
        try {
            const req = await httpStream(URL)
            console.log(`Downloading ${name}`)
            await unzip(req, path => path.toUpperCase().endsWith(BIN_FILE) && TEMP) // give a temp name
            const s = await statWithTimeout(TEMP) // check existence
            if (s.size < 1E6)
                throw `Bad size for geo_ip: ${s.size}`
            if (isOpen())
                ip2location.close()
            await rename(TEMP, LOCAL_FILE)
            console.log(`${name} download completed`)
        }
        catch (e: any) {
            console.error(`Failed to download ${name}${mtime ? ", falling back on old data" : ''}:`, e?.message || String(e))
        }
    else if (isOpen()) return
    console.debug(`Loading ${name}`)
    ip2location.open(LOCAL_FILE) // using openAsync causes a DEP0137 error within 10 seconds
    ip2country.cache.clear?.() // invalidate earlier misses even when the existing file was opened without a download
}

declare module 'koa' {
    interface DefaultState {
        geoCountry?: string
    }
}

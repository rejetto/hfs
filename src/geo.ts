import { defineConfig } from './config'
import { CFG, DAY, httpStream, isIpLan, isLocalHost, statWithTimeout, unzip } from './misc'
import { rename, unlink } from 'node:fs/promises'
import { IP2Location } from 'ip2location-nodejs'
import _ from 'lodash'
import { Middleware } from 'koa'
import { disconnect, updateConnection } from './connections'

const ip2location = new IP2Location()
const enabled = defineConfig(CFG.geo_enable, false)
const allow = defineConfig<boolean | null>(CFG.geo_allow, null)
const list = defineConfig(CFG.geo_list, [] as string[])
const allowUnknown = defineConfig(CFG.geo_allow_unknown, false)
enabled.sub(checkFiles)
setInterval(checkFiles, DAY) // keep updated at run-time

// benchmark: memoize can make this 44x faster
export const ip2country = _.memoize((ip: string) => ip2location.getCountryShortAsync(ip).then(v => v === '-' ? '' : v, () => ''))

export const geoFilter: Middleware = async (ctx, next) => {
    if (enabled.get() && !isLocalHost(ctx) && !isIpLan(ctx.ip)) {
        const { connection }  = ctx.state
        const country = connection.country ??= await ip2country(ctx.ip)
        if (country)
            updateConnection(connection, { country })
        if (!ctx.state.skipFilters && allow.get() !== null)
            if (country ? list.get().includes(country) !== allow.get() : !allowUnknown.get())
                return disconnect(ctx, 'geo-filter')
    }
    await next()
}

function isOpen() {
    return Boolean(ip2location.getPackageVersion())
}

async function checkFiles() {
    if (!enabled.get()) return
    const ZIP_FILE = 'IP2LOCATION-LITE-DB1.IPV6.BIN'
    const URL = `https://download.ip2location.com/lite/${ZIP_FILE}.ZIP`
    const LOCAL_FILE = 'geo_ip.bin'
    const TEMP = LOCAL_FILE + '.downloading'
    const { mtime=0 } = await statWithTimeout(LOCAL_FILE).catch(() => ({ mtime: 0 }))
    const name = 'geo-ip db'
    const now = Date.now()
    if (+mtime < now - 31 * DAY) // month-old or non-existing
        try {
            const req = await httpStream(URL)
            console.log(`downloading ${name}`)
            await unzip(req, path => path.toUpperCase().endsWith(ZIP_FILE) && TEMP)
            await statWithTimeout(TEMP) // check existence
            if (isOpen())
                ip2location.close()
            await unlink(LOCAL_FILE).catch(() => {})
            await rename(TEMP, LOCAL_FILE)
            ip2country.cache.clear?.()
            console.log(`${name} download completed`)
        }
        catch (e: any) {
            console.error(`Failed to download ${name}${mtime ? ", falling back on old data" : ''}:`, e?.message || String(e))
        }
    else if (isOpen()) return
    console.debug(`loading ${name}`)
    ip2location.open(LOCAL_FILE) // using openAsync causes a DEP0137 error within 10 seconds
}

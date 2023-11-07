import { defineConfig } from './config'
import { CFG, DAY, httpStream, isLocalHost, unzip } from './misc'
import { stat, rename, unlink } from 'node:fs/promises'
import { IP2Location } from 'ip2location-nodejs'
import _ from 'lodash'
import { Middleware } from 'koa'
import { updateConnection } from './connections'

const ip2location = new IP2Location()
const enabled = defineConfig(CFG.geo_enable, false)
const allow = defineConfig<boolean | null>(CFG.geo_allow, null)
const list = defineConfig(CFG.geo_list, [] as string[])
const allowUnknown = defineConfig(CFG.geo_allow_unknown, false)
enabled.sub(checkFiles)
setInterval(checkFiles, DAY) // keep updated at run-time

export const ip2country = _.memoize((ip: string) => ip2location.getCountryShortAsync(ip).then(v => v === '-' ? '' : v, () => ''))

export const geoFilter: Middleware = async (ctx, next) => {
    if (allow.get() !== null && !isLocalHost(ctx)) {
        const { connection }  = ctx.state
        const country = connection.country ??= await ip2country(ctx.ip)
        updateConnection(connection, { country })
        if (country ? list.get().includes(country) !== allow.get() : !allowUnknown.get())
            return ctx.socket.destroy()
    }
    return next()
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
    const { mtime=0 } = await stat(LOCAL_FILE).catch(() => ({ mtime: 0 }))
    const now = Date.now()
    if (mtime < now - 31 * DAY) { // month-old or non-existing
        console.log('downloading geo-ip db')
        await unzip(await httpStream(URL), path =>
            path.toUpperCase().endsWith(ZIP_FILE) && TEMP)
        if (await stat(TEMP))
        if (isOpen())
            ip2location.close()
        await unlink(LOCAL_FILE).catch(() => {})
        await rename(TEMP, LOCAL_FILE)
        ip2country.cache.clear?.()
        console.log('download geo-ip db completed')
    }
    else if (isOpen()) return
    console.debug('loading geo-ip db')
    ip2location.open(LOCAL_FILE) // using openAsync causes a DEP0137 error within 10 seconds
}

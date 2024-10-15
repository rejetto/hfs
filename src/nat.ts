import { proxy } from 'valtio'
import { Client } from 'nat-upnp-rejetto'
import { debounceAsync } from './debounceAsync'
import { haveTimeout, HOUR, inCommon, ipForUrl, MINUTE, promiseBestEffort, repeat, wantArray } from './cross'
import { getProjectInfo } from './github'
import _ from 'lodash'
import { httpString } from './util-http'
import { Resolver } from 'dns/promises'
import { isIP } from 'net'
import { getIps, getServerStatus } from './listen'
import { exec } from 'child_process'
import { IS_MAC, IS_WINDOWS } from './const'

export const defaultBaseUrl = proxy({
    proto: 'http',
    publicIps: [] as string[],
    externalIp: '',
    localIp: '',
    port: 0,
    async get() {
        const defPort = this.proto === 'https' ? 443 : 80
        const status = await getServerStatus()
        const port = this.port || (this.proto === 'https' ? status.https.port : status.http.port)
        return `${this.proto}://${ipForUrl(this.publicIps[0] || this.externalIp || this.localIp)}${!port || port === defPort ? '' : ':' + port}`
    }
})

export const upnpClient = new Client({ timeout: 4_000 })
const originalMethod = upnpClient.getGateway
// other client methods call getGateway too, so this will ensure they reuse this same result
upnpClient.getGateway = debounceAsync(() => originalMethod.apply(upnpClient), { retain: HOUR, retainFailure: 30_000 })
upnpClient.getGateway().then(res => {
    console.log('upnp', res.gateway.description)
}, e => console.debug('upnp failed:', e.message || String(e)))

// poll external ip
repeat(10 * MINUTE, () => upnpClient.getPublicIp().then(v => {
    if (v === defaultBaseUrl.externalIp) return
    getPublicIps.clearRetain()
    return defaultBaseUrl.externalIp = v
}))

export const getPublicIps = debounceAsync(async () => {
    const res = await getProjectInfo()
    const groupedByVersion = Object.values(_.groupBy(res.publicIpServices, x => x.v ?? 4))
    const ips = await promiseBestEffort(groupedByVersion.map(singleVersion =>
        Promise.any(singleVersion.map(async (svc: any) => {
            if (typeof svc === 'string')
                svc = { type: 'http', url: svc }
            console.debug("trying ip service", svc.url || svc.name)
            if (svc.type === 'http')
                return httpString(svc.url, { timeout: 5_000 })
            if (svc.type !== 'dns') throw "unsupported"
            const resolver = new Resolver({ timeout: 2_000 })
            resolver.setServers(svc.ips)
            return resolver.resolve(svc.name, svc.dnsRecord)
        }).map(async ret => {
            const validIps = wantArray(await ret).map(x => x.trim()).filter(isIP)
            if (!validIps.length) throw "no good"
            return validIps
        }) )))
    return defaultBaseUrl.publicIps = _.uniq(ips.flat())
}, { retain: 10 * MINUTE })

export const getNatInfo = debounceAsync(async () => {
    const gatewayIpPromise = findGateway().catch(() => undefined)
    const res = await haveTimeout(10_000, upnpClient.getGateway()).catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await haveTimeout(5_000, upnpClient.getMappings()).catch(() => null)
    console.debug("mappings found", mappings?.map(x => x.description) || "none")
    const localIps = await getIps(false)
    const gatewayIp = await gatewayIpPromise
    const localIp = res?.address || (gatewayIp ? _.maxBy(localIps, x => inCommon(x, gatewayIp)) : localIps[0])
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port || undefined
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort)
    const externalPort = mapped?.public.port
    if (localIp)
        defaultBaseUrl.localIp = localIp
    defaultBaseUrl.port = externalPort || internalPort || 0
    return {
        upnp: Boolean(res),
        localIp,
        gatewayIp,
        externalIp: defaultBaseUrl.externalIp,
        mapped,
        mapped80: _.find(mappings, x => x.private.host === localIp && x.private.port === 80 && x.public.port === 80),
        internalPort,
        externalPort,
        proto: status?.https?.listening ? 'https' : status?.http?.listening ? 'http' : '',
    }
})
getNatInfo()

function findGateway(): Promise<string | undefined> {
    return new Promise((resolve, reject) =>
        exec(IS_WINDOWS || IS_MAC ? 'netstat -rn' : 'route -n', (err, out) => {
            if (err) return reject(err)
            if (!IS_WINDOWS)
                return resolve(out.match(IS_MAC ? /default +([\d.]+)/ : /^0\.0\.0\.0 +([\d.]+)/)?.[1])
            const sortedByMetric = _.sortBy([...out.matchAll(/(?:0\.0\.0\.0 +){2}([\d.]+)\s+[\d.]+\s+(\d+)/g)], x => Number(x[2]))
            resolve(sortedByMetric[0]?.[1]) // take ip with lowest metric
        }) )
}

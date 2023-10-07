// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp-ts'
import { HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_OK, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE,
    HTTP_PRECONDITION_FAILED, IS_MAC, IS_WINDOWS, SPECIAL_URI
} from './const'
import _ from 'lodash'
import { cert, getCertObject, getIps, getServerStatus, privateKey } from './listen'
import { getProjectInfo } from './github'
import { httpString } from './util-http'
import { exec } from 'child_process'
import {
    apiAssertTypes, DAY, debounceAsync, haveTimeout, HOUR, MINUTE, objSameKeys, onlyTruthy, repeat, Dict,
    GetNat, promiseBestEffort, wantArray
} from './misc'
import acme from 'acme-client'
import fs from 'fs/promises'
import { createServer, RequestListener } from 'http'
import { Middleware } from 'koa'
import { lookup, Resolver } from 'dns/promises'
import { defineConfig } from './config'
import events from './events'
import { isIP, isIPv6 } from 'net'

const upnpClient = new Client({ timeout: 4_000 })
const originalMethod = upnpClient.getGateway
// other client methods call getGateway too, so this will ensure they reuse this same result
upnpClient.getGateway = debounceAsync(() => originalMethod.apply(upnpClient), 0, { retain: HOUR, retainFailure: 30_000 })
upnpClient.getGateway().catch(() => {})

export let externalIp = '' // poll external ip
repeat(10 * MINUTE, () => upnpClient.getPublicIp().then(v => {
    if (v !== externalIp)
        getPublicIps.clearRetain()
    return externalIp = v
}))

const getNatInfo = debounceAsync(async () => {
    const gettingIps = getPublicIps() // don't wait, do it in parallel
    const res = await upnpClient.getGateway().catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await haveTimeout(5_000, upnpClient.getMappings()).catch(() => null)
    console.debug('mappings found', mappings?.map(x => x.description))
    const gatewayIp = res ? new URL(res.gateway.description).hostname : await findGateway().catch(() => undefined)
    const localIp = res?.address || (await getIps())[0]
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port || undefined
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort)
    return {
        upnp: Boolean(res),
        localIp,
        gatewayIp,
        publicIps: await gettingIps,
        externalIp,
        mapped,
        internalPort,
        externalPort: mapped?.public.port,
        proto: status?.https?.listening ? 'https' : status?.http?.listening ? 'http' : undefined,
    } satisfies GetNat
})

const getPublicIps = debounceAsync(async () => {
    const res = await getProjectInfo()
    const groupedByVersion = Object.values(_.groupBy(res.publicIpServices, x => x.v ?? 4))
    const ips = await promiseBestEffort(groupedByVersion.map(singleVersion =>
        Promise.any(singleVersion.map(async (svc: any) => {
            if (typeof svc === 'string')
                svc = { type: 'http', url: svc }
            console.debug("trying ip service", svc.url || svc.name)
            if (svc.type === 'http')
                return httpString(svc.url)
            if (svc.type !== 'dns') throw "unsupported"
            const resolver = new Resolver({ timeout: 2_000 })
            resolver.setServers(svc.ips)
            return resolver.resolve(svc.name, svc.dnsRecord)
        }).map(async ret => {
            const validIps = wantArray(await ret).map(x => x.trim()).filter(isIP)
            if (!validIps.length) throw "no good"
            return validIps
        }) )))
    return _.uniq(ips.flat())
}, 0, { retain: 10 * MINUTE })

function findGateway(): Promise<string | undefined> {
    return new Promise((resolve, reject) =>
        exec(IS_WINDOWS || IS_MAC ? 'netstat -rn' : 'route -n', (err, out) => {
            if (err) return reject(err)
            const re = IS_WINDOWS ? /(?:0\.0\.0\.0 +){2}([\d.]+)/ : IS_MAC ? /default +([\d.]+)/ : /^0\.0\.0\.0 +([\d.]+)/
            resolve(re.exec(out)?.[1])
        }) )
}

let acmeMiddlewareEnabled = false
const acmeTokens: Dict<string> = {}
const acmeListener: RequestListener = (req, res) => { // node format
    const BASE = '/.well-known/acme-challenge/'
    if (!req.url?.startsWith(BASE)) return
    const token = req.url.slice(BASE.length)
    console.debug("got http challenge", token)
    res.statusCode = HTTP_OK
    res.end(acmeTokens[token])
    return true
}
export const acmeMiddleware: Middleware = (ctx, next) => { // koa format
    if (!acmeMiddlewareEnabled || !Boolean(acmeListener(ctx.req, ctx.res)))
        return next()
}

let selfCheckMiddlewareEnabled = false
const CHECK_URL = SPECIAL_URI + 'self-check'
export const selfCheckMiddleware: Middleware = (ctx, next) => { // koa format
    if (!selfCheckMiddlewareEnabled || !ctx.url.startsWith(CHECK_URL))
        return next()
    ctx.body = 'HFS'
}

async function checkDomain(domain: string) {
    const resolver = new Resolver()
    const prjInfo = await getProjectInfo()
    resolver.setServers(prjInfo.dnsServers)
    const settled = await Promise.allSettled([
        resolver.resolve(domain, 'A'),
        resolver.resolve(domain, 'AAAA'),
        lookup(domain).then(x => [x.address]),
    ])
    // merge all results
    const domainIps = _.uniq(onlyTruthy(settled.map(x => x.status === 'fulfilled' && x.value)).flat())
    if (!domainIps.length)
        throw new ApiError(HTTP_FAILED_DEPENDENCY, "domain not working")
    const { publicIps } = await getNatInfo() // do this before stopping the server
    for (const v6 of [false, true]) {
        const domainIpsThisVersion = domainIps.filter(x => isIPv6(x) === v6)
        const ipsThisVersion = publicIps.filter(x => isIPv6(x) === v6)
        if (domainIpsThisVersion.length && ipsThisVersion.length && !_.intersection(domainIpsThisVersion, ipsThisVersion).length)
            throw new ApiError(HTTP_PRECONDITION_FAILED, `configure your domain to point to ${ipsThisVersion} (currently on ${domainIpsThisVersion[0]}) – a change can take hours to be effective`)
    }
}

async function generateSSLCert(domain: string, email?: string) {
    // will answer challenge through our koa app (if on port 80) or must we spawn a dedicated server?
    const { upnp, externalPort } = await getNatInfo()
    const { http } = await getServerStatus()
    const tempSrv = externalPort === 80 || http.listening && http.port === 80 ? undefined : createServer(acmeListener)
    if (tempSrv)
        await new Promise<void>((resolve) =>
            tempSrv.listen(80, resolve).on('error', (e: any) => {
                console.debug("cannot listen on 80", e.code || e)
                resolve() // go on anyway
            }) )
    acmeMiddlewareEnabled = true
    console.debug('acme challenge server ready')
    try {
        const checkUrl = `http://${domain}`
        let check = await selfCheck(checkUrl) // some check services may not consider the domain, but we already verified that
        if (check && !check.success && upnp && externalPort !== 80) { // consider a short-lived mapping
            console.debug("setting temporary port forward")
            // @ts-ignore
            await upnpClient.createMapping({ private: 80, public: { host: '', port: 80 }, description: 'hfs temporary', ttl: 30 }).catch(() => {})
            check = await selfCheck(checkUrl) // repeat test
        }
        //if (!check) throw new ApiError(HTTP_FAILED_DEPENDENCY, "couldn't test port 80")
        if (!check?.success)
            throw new ApiError(HTTP_FAILED_DEPENDENCY, "port 80 is not working on the specified domain")
        const acmeClient = new acme.Client({
            accountKey: await acme.crypto.createPrivateKey(),
            directoryUrl: acme.directory.letsencrypt.production
        })
        const [key, csr] = await acme.crypto.createCsr({ commonName: domain })
        const cert = await acmeClient.auto({
            csr,
            email,
            challengePriority: ['http-01'],
            skipChallengeVerification: true, // on NAT, trying to connect to your external ip will likely get your modem instead of the challenge server
            termsOfServiceAgreed: true,
            async challengeCreateFn(_, c, ka) {
                console.debug("producing challenge")
                acmeTokens[c.token] = ka
            },
            async challengeRemoveFn(_, c) {
                delete acmeTokens[c.token]
            },
        })
        return { key, cert }
    }
    finally {
        acmeMiddlewareEnabled = false
        if (tempSrv) await new Promise(res => tempSrv.close(res))
        console.debug('acme terminated')
    }
}

async function checkService(url: string, serviceKey: string) {
    interface PortScannerService {
        type?: string
        url: string
        headers: {[k: string]: string}
        method: string
        body?: string
        regexpFailure: string
        regexpSuccess: string
    }
    const prjInfo = await getProjectInfo()
    console.log(`checking server ${url}`)
    selfCheckMiddlewareEnabled = true
    try {
        const parsed = new URL(url)
        const family = !isIP(parsed.hostname) ? undefined : isIPv6(parsed.hostname) ? 6 : 4
        for (const services of _.chunk(_.shuffle<PortScannerService>(prjInfo[serviceKey]), 2)) {
            try {
                return await Promise.any(services.map(async (svc) => {
                    if (!svc.url || svc.type) throw 'unsupported ' + svc.type // only default type supported for now
                    let { url: serviceUrl, body, regexpSuccess, regexpFailure, ...rest } = svc
                    const service = new URL(serviceUrl).hostname
                    console.log('trying external service', service)
                    body = applySymbols(body)
                    serviceUrl = applySymbols(serviceUrl)!
                    const res = await haveTimeout(10_000, httpString(serviceUrl, { family, ...rest, body }))
                    const success = new RegExp(regexpSuccess).test(res)
                    const failure = new RegExp(regexpFailure).test(res)
                    if (success === failure) throw 'inconsistent: ' + service + ': ' + res // this result cannot be trusted
                    console.debug(service, 'responded', success)
                    return { success, service, url }
                }))
            }
            catch (e: any) {
                console.debug(e?.errors?.map(String) || e?.cause || String(e))
            }
        }

        function applySymbols(s?: string) {
            return s?.replace('$IP', parsed.hostname)
                .replace('$PORT', parsed.port || (parsed.protocol === 'https:' ? '443' : '80'))
                .replace('$URL', url.replace(/\/$/, '') + CHECK_URL)
        }
    }
    finally {
        selfCheckMiddlewareEnabled = false
    }
}

function selfCheck(url: string) {
    return checkService(url, 'selfCheckServices')
}

const apis: ApiHandlers = {
    get_nat: getNatInfo,

    check_domain({ domain }) {
        apiAssertTypes({ string: domain })
        return checkDomain(domain)
    },

    async map_port({ external, internal }) {
        const { upnp, externalPort, internalPort } = await getNatInfo()
        if (!upnp)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'upnp failed')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        if (externalPort)
            try { await upnpClient.removeMapping({ public: { host: '', port: externalPort } }) }
            catch (e: any) { return new ApiError(HTTP_SERVER_ERROR, 'removeMapping failed: ' + String(e) ) }
        if (external) // must use the object form of 'public' to work around a bug of the library
            await upnpClient.createMapping({ private: internal || internalPort, public: { host: '', port: external }, description: 'hfs', ttl: 0 })
        return {}
    },

    async self_check({ url }) {
        if (url)
            return await selfCheck(url)
                || new ApiError(HTTP_SERVICE_UNAVAILABLE)
        const nat = await getNatInfo()
        if (!nat.publicIps.length)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'cannot detect public ip')
        if (!nat.internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        const finalPort = nat.externalPort || nat.internalPort
        const proto = nat.proto || (getCertObject() ? 'https' : 'http')
        const defPort = proto === 'https' ? 443 : 80
        const results = onlyTruthy(await promiseBestEffort(nat.publicIps.map(ip =>
            selfCheck(`${proto}://${ip}${finalPort === defPort ? '' : ':' + finalPort}`) )))
        return results.length ? results : new ApiError(HTTP_SERVICE_UNAVAILABLE)
    },

    async make_cert({domain, email}) {
        await makeCert(domain, email)
        return {}
    },

    get_cert() {
        return objSameKeys(_.pick(getCertObject(), ['subject', 'issuer', 'validFrom', 'validTo']), v => v)
    }
}

export const acme_domain = defineConfig<string>('acme_domain', '')
export const acme_email = defineConfig<string>('acme_email', '')

export const makeCert = debounceAsync(async (domain: string, email?: string) => {
    if (!domain) return new ApiError(HTTP_BAD_REQUEST, 'bad params')
    const res = await generateSSLCert(domain, email)
    const CERT_FILE = 'acme.cert'
    const KEY_FILE = 'acme.key'
    await fs.writeFile(CERT_FILE, res.cert)
    await fs.writeFile(KEY_FILE, res.key)
    cert.set(CERT_FILE) // update config
    privateKey.set(KEY_FILE) 
}, 0)

defineConfig('acme_renew', false) // handle config changes
events.once('https ready', () => repeat(HOUR, renewCert))

// checks if the cert is near expiration date, and if so renews it
const renewCert = debounceAsync(async () => {
    const cert = getCertObject()
    if (!cert) return
    const now = new Date()
    const validTo = new Date(cert.validTo)
    // not expiring in a month
    if (now > new Date(cert.validFrom) && now < validTo && validTo.getTime() - now.getTime() >= 30 * DAY)
        return console.log("certificate still good")
    await makeCert(acme_domain.get(), acme_email.get())
        .catch(e => console.log("error renewing certificate: ", String(e)))
}, 0, { retain: DAY, retainFailure: HOUR })

export default apis
// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp-ts'
import {
    HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_OK, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE,
    IS_MAC, IS_WINDOWS
} from './const'
import _ from 'lodash'
import { cert, getCertObject, getIps, getServerStatus, privateKey } from './listen'
import { getProjectInfo } from './github'
import { httpString } from './util-http'
import { exec } from 'child_process'
import { apiAssertTypes, DAY, debounceAsync, haveTimeout, HOUR, MINUTE, objSameKeys, onlyTruthy, repeat, Dict, GetNat,
    parallelJobs } from './misc'
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
repeat(10 * MINUTE, () => upnpClient.getPublicIp().then(v => externalIp = v))

const getNatInfo = debounceAsync(async () => {
    const gettingIps = getPublicIps() // don't wait, do it in parallel
    const res = await upnpClient.getGateway().catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await haveTimeout(5_000, upnpClient.getMappings()).catch(() => null)
    console.debug('mappings found', mappings)
    const gatewayIp = res ? new URL(res.gateway.description).hostname : await findGateway().catch(() => undefined)
    const localIp = res?.address || (await getIps())[0]
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port || undefined
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort)
    return {
        upnp: Boolean(res),
        localIp,
        gatewayIp,
        publicIps: Object.values(await gettingIps),
        externalIp,
        mapped,
        internalPort,
        externalPort: mapped?.public.port,
    } satisfies GetNat
})

async function getPublicIps() {
    const ret: any = {}
    const attemptsMade: any = { 4: 0, 6: 0 }
    const prjInfo = await getProjectInfo()
    // small parallelization. The logic is a bit complex because considers many things
    await parallelJobs(2, prjInfo.publicIpServices_049.map((s: any) => async () => {
        if (ret[4] && ret[6]) return // no more to do
        if (s.v && s.v !== 46 && ret[s.v] || s.prefers && ret[s.prefers]) return // no good
        const expected = String(s.v||'').split('')
        const checkAttempt = expected.length === 1 ? expected[0]! : ret[4] ? 6 : ret[6] ? 4 : 0
        if (attemptsMade[checkAttempt] > 1) return // give up on this (you may not have this version, after all)
        console.debug("trying service", s.url)
        for (const k of expected) attemptsMade[k]++
        const res = await httpString(s.url).catch(() => null)
        if (!res) return
        for (const afterV of s.v && s.after && expected.length ? expected : ['']) {
            if (ret[afterV]) continue
            let workOn = res
            if (s.after) {
                const found = workOn.match(new RegExp(s.after.replace('$V', afterV), 'i'))
                workOn = !found ? '' : workOn.slice(found.index! + found[0].length)
            }
            const ip = workOn.match(/[.:0-9a-fA-F]+/)?.[0]?.trim()
            if (ip && isIP(ip)) {
                ret[isIPv6(ip) ? 6 : 4] = ip
                continue
            }
            if (s.v === afterV)
                console.debug("bad reply", s.url)
        }
    }))
    return ret
}

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
            throw new ApiError(HTTP_FAILED_DEPENDENCY, `configure your domain to point to ${ipsThisVersion} (currently on ${domainIpsThisVersion[0]}) – a change can take hours to be effective`)
    }
}

async function generateSSLCert(domain: string, email?: string) {
    await checkDomain(domain)
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
        let check = await checkPort(domain, 80) // some check services may not consider the domain, but we already verified that
        if (check && !check.success && upnp && externalPort !== 80) { // consider a short-lived mapping
            // @ts-ignore
            await upnpClient.createMapping({ private: 80, public: { host: '', port: 80 }, description: 'hfs temporary', ttl: 30 }).catch(() => {})
            check = await checkPort(domain, 80) // repeat test
        }
        if (!check)
            throw new ApiError(HTTP_FAILED_DEPENDENCY, "couldn't test port 80")
        if (!check.success)
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

async function checkPort(ip: string, port: number) {
    interface PortScannerService {
        url: string
        headers: {[k: string]: string}
        method: string
        selector: string
        body?: string
        regexpFailure: string
        regexpSuccess: string
    }
    const prjInfo = await getProjectInfo()
    for (const services of _.chunk(_.shuffle<PortScannerService>(prjInfo.checkServerServices), 2)) {
        try {
            return Promise.any(services.map(async ({ url, body, selector, regexpSuccess, regexpFailure, ...rest }) => {
                const service = new URL(url).hostname
                console.log('trying service', service)
                const res = await httpString(applySymbols(url)!, { ...rest, body: applySymbols(body) })
                const success = new RegExp(regexpSuccess).test(res)
                const failure = new RegExp(regexpFailure).test(res)
                if (success === failure) throw console.debug('inconsistent:' + service) // this result cannot be trusted
                console.debug(service, 'responded', success)
                return { success, service }
            }))
        }
        catch {}
    }

    function applySymbols(s?: string) {
        return s?.replace('$IP', ip).replace('$PORT', String(port))
    }
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

    async check_server({ port }) {
        const { publicIps, internalPort, externalPort } = await getNatInfo()
        const ip = publicIps[0]
        if (!ip)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'cannot detect public ip')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        port ||= externalPort || internalPort
        console.log(`checking server ${ip}:${port}`)
        return await checkPort(ip, port)
            || new ApiError(HTTP_SERVICE_UNAVAILABLE)
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
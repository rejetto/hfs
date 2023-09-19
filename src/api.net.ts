// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'
import {
    HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_OK, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE,
    IS_MAC, IS_WINDOWS
} from './const'
import axios from 'axios'
import {parse} from 'node-html-parser'
import _ from 'lodash'
import { cert, getCertObject, getIps, getServerStatus, privateKey } from './listen'
import { getProjectInfo } from './github'
import { httpString } from './util-http'
import { exec } from 'child_process'
import { apiAssertTypes, DAY, debounceAsync, haveTimeout, HOUR, MINUTE, objSameKeys, onlyTruthy, repeat, Dict} from './misc'
import acme from 'acme-client'
import fs from 'fs/promises'
import { createServer, RequestListener } from 'http'
import { Middleware } from 'koa'
import { lookup, Resolver } from 'dns/promises'
import { defineConfig } from './config'
import events from './events'

const upnpClient = new Client({ timeout: 4_000 })
const originalMethod = upnpClient.getGateway
// other client methods call getGateway too, so this will ensure they reuse this same result
upnpClient.getGateway = debounceAsync(() => originalMethod.apply(upnpClient), 0, { retain: HOUR, retainFailure: 30_000 })
upnpClient.getGateway().catch(() => {})

export let externalIp = Promise.resolve('') // poll external ip
repeat(10 * MINUTE, () => {
    const was = externalIp
    externalIp = upnpClient.getPublicIp().catch(() => was) //fallback to previous value
})

const getNatInfo = debounceAsync(async () => {
    const gettingIp = getPublicIp() // don't wait, do it in parallel
    const res = await upnpClient.getGateway().catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await upnpClient.getMappings().catch(() => null)
    console.debug('mappings found', mappings)
    const gatewayIp = res ? new URL(res.gateway.description).hostname : await findGateway().catch(() => null)
    const localIp = res?.address || (await getIps())[0]
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort)
    return {
        upnp: Boolean(res),
        localIp,
        gatewayIp,
        publicIp: await gettingIp || await externalIp,
        externalIp: await externalIp,
        mapped,
        internalPort,
        externalPort: mapped?.public.port,
    }
})

async function getPublicIp() {
    const prjInfo = await getProjectInfo()
    for (const urls of _.chunk(_.shuffle(prjInfo.publicIpServices), 2)) // small parallelization
        try {
            return await Promise.any(urls.map(url => httpString(url).then(res => {
                const ip = res.body?.trim()
                if (!/[.:0-9a-fA-F]/.test(ip))
                    throw Error("bad result: " + ip)
                return ip
            })))
        }
        catch (e: any) { console.debug(String(e)) }
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
    const ips = _.uniq(onlyTruthy(settled.map(x => x.status === 'fulfilled' && x.value)).flat())
    if (!ips.length)
        throw new ApiError(HTTP_FAILED_DEPENDENCY, "domain not working")
    const { publicIp } = await getNatInfo() // do this before stopping the server
    if (!ips.includes(publicIp))
        throw new ApiError(HTTP_FAILED_DEPENDENCY, `please configure your domain to point to ${publicIp} (currently on ${ips[0]}) --- a change can take hours to be effective`)
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
            await upnpClient.createMapping({ private: 80, public: { host: '', port: 80 }, description: 'hfs challenge', ttl: 0 }).catch(() => {})
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
            return Promise.any(services.map(async svc => {
                const service = new URL(svc.url).hostname
                console.log('trying service', service)
                const api = (axios as any)[svc.method]
                const body = svc.body?.replace('$IP', ip).replace('$PORT', String(port)) || ''
                const res = await api(svc.url, body, {headers: svc.headers})
                const parsed = parse(res.data).querySelector(svc.selector)?.innerText
                if (!parsed) throw console.debug('empty:' + service)
                const success = new RegExp(svc.regexpSuccess).test(parsed)
                const failure = new RegExp(svc.regexpFailure).test(parsed)
                if (success === failure) throw console.debug('inconsistent:' + service) // this result cannot be trusted
                console.debug(service, 'responded', success)
                return { success, service }
            }))
        }
        catch {}
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
        const { publicIp, internalPort, externalPort } = await getNatInfo()
        if (!publicIp)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'cannot detect public ip')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        port ||= externalPort || internalPort
        console.log(`checking server ${publicIp}:${port}`)
        return await checkPort(publicIp, port)
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

export async function makeCert(domain: string, email?: string) {
    if (!domain) return new ApiError(HTTP_BAD_REQUEST, 'bad params')
    const res = await generateSSLCert(domain, email)
    const CERT_FILE = 'acme.cert'
    const KEY_FILE = 'acme.key'
    await fs.writeFile(CERT_FILE, res.cert)
    await fs.writeFile(KEY_FILE, res.key)
    cert.set(CERT_FILE) // update config
    privateKey.set(KEY_FILE) 
}

export const renewAcme = {
    timer: null,
    reset() {
        if (this.timer !== null)
            clearTimeout(this.timer)
        this.timer = null
    },
    set() {
        if (this.timer !== null) {
            setTimeout(this.set.bind(this), 5_000);
        } else {
            this.reset()
            setImmediate(() => repeat(DAY, renewCert)
                .then(v => ((this.timer as any) = v)))
        }
    }
}

defineConfig('acme_renew', false) // handle config changes
events.once('https ready', () => renewAcme.set())
/**
 * checks if the cert is near expiration date.
 * if so renews it
 */
async function renewCert() {
    const acmeLog = (...args: any[]) => console.log('[acme-renew]:', ...args)
    const now = new Date()
    const cert = getCertObject()
    if (!cert) return
    const validTo = new Date(cert.validTo)
    const isValid = now > new Date(cert.validFrom) && now < validTo &&
                    validTo.getTime() - now.getTime() >= 30 * DAY // it's not expiring in a month
    if (isValid) return acmeLog("cert is valid")
    await makeCert(acme_domain.get(), acme_email.get())
        .catch(e => {
            acmeLog("error renewing cert:", e.toString())
        })
}

export default apis
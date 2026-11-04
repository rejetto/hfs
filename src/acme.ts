import {
    Dict, haveTimeout, HOUR, HTTP_FAILED_DEPENDENCY, HTTP_OK, ipForUrl, MINUTE, repeat, formatDate,
} from './misc'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Middleware } from 'koa'
import { getNatInfo, getUpnpClient, upnpEnabled, upnpMappingParam } from './nat'
import { cert, getCertObject, getServerStatus, privateKey } from './listen'
import { ApiError } from './apiMiddleware'
import acme from 'acme-client'
import { debounceAsync } from './debounceAsync'
import fs from 'fs/promises'
import { acmeDomain, acmeRenew, acmeChallenge, acmeDns } from './acmeConfig'
import { certificateNames, getDnsProviders, dnsChallengeRecord, waitForDnsRecord, DnsCleanup } from './acmeDns'
import { getProjectInfo } from './github'
import { Resolver } from 'node:dns/promises'
import { Readable } from 'node:stream'
import events from './events'
import { selfCheck } from './selfCheck'
import { isIP } from 'net'

let acmeOngoing = false
const acmeTokens: Dict<string> = {}
const acmeListener = (req: IncomingMessage, res: ServerResponse) => { // node listener
    const BASE = '/.well-known/acme-challenge/'
    if (!req.url?.startsWith(BASE)) return
    const token = req.url.slice(BASE.length)
    console.debug("Got http challenge", token)
    res.statusCode = HTTP_OK
    res.end(acmeTokens[token])
    return true // true = responded
}
export const acmeMiddleware: Middleware = (ctx, next) => { // koa format
    if (!acmeOngoing || !acmeListener(ctx.req, ctx.res))
        return next()
}

const TEMP_MAP = upnpMappingParam(80, 80, 'hfs temporary', 5000) // from my tests (zyxel VMG8825), lower values won't make a working mapping

// remove temporary port mapping, if any is left from previous execution
repeat(MINUTE, async stop => {
    if (!await upnpEnabled.getWhenReady())
        return stop()
    const client = getUpnpClient()
    await client.getGateway() // without this, the next call will break upnp support
    const res = await client.getMappings()
    const leftover = res.find(x => x.description === TEMP_MAP.description) // in case the process is interrupted
    if (!leftover) return void stop() // we are good
    if (acmeOngoing) return // it doesn't count, as we are in the middle of something. Retry later
    stop()
    return client.removeMapping(TEMP_MAP)
})

async function generateSSLCert(names: string[], email?: string) {
    const domain = names[0]!
    const method = acmeChallenge.get()
    const ipCertificate = names.some(isIP)
    if (!['http-01', 'dns-01'].includes(method)) throw Error("Invalid certificate validation method")
    if (method === 'http-01' && names.some(n => n.startsWith('*.'))) throw Error("Select a DNS provider for wildcard certificates")
    if (method === 'dns-01' && ipCertificate) throw Error("DNS validation cannot be used for IP addresses")
    const config = structuredClone(acmeDns.get()[0])
    const info = method === 'dns-01' ? await getProjectInfo() : undefined
    const provider = info && config && getDnsProviders(info.acmeDns).get(config.provider)
    if (method === 'dns-01') {
        if (!provider?.available || config?.config_version !== provider.config_version)
            throw Error("DNS provider unavailable or incompatible; update HFS or reconfigure the provider")
        if (Object.keys(provider.fields).some(k => !config!.credentials?.[k])) throw Error("Enter the DNS provider credentials")
    }
    const resolver = new Resolver({ timeout: 3000, tries: 2 })
    if (info) resolver.setServers(info.dnsServers)
    const cleanups = new Map<string, DnsCleanup>()
    const cleanupErrors: string[] = []
    let tempSrv: ReturnType<typeof createServer> | undefined
    let tempMap: Awaited<ReturnType<ReturnType<typeof getUpnpClient>['createMapping']>> | undefined
    acmeOngoing = true
    try {
        if (method === 'http-01') {
            progress("Checking port 80")
            const nat = await getNatInfo()
            const { http } = await getServerStatus()
            if (!(nat.externalPort === 80 || http.listening && http.port === 80)) {
                tempSrv = createServer((req, res) => acmeListener(req, res) || res.end('HFS'))
                await new Promise<void>(resolve => tempSrv!.listen(80, resolve).on('error', () => resolve()))
            }
            const checkUrl = `http://${ipForUrl(domain)}`
            let check = await selfCheck(checkUrl)
            if (check?.success === false && nat.upnp && !nat.mapped80) {
                tempMap = await haveTimeout(10_000, getUpnpClient().createMapping(TEMP_MAP)).catch(() => undefined)
                check = await selfCheck(checkUrl)
            }
            if (check?.success === false) throw new ApiError(HTTP_FAILED_DEPENDENCY, "port 80 is not working on the specified domain")
        }
        progress("Requesting certificate")
        const acmeClient = new acme.Client({
            accountKey: await acme.crypto.createPrivateKey(),
            directoryUrl: acme.directory.letsencrypt.production
        })
        if (ipCertificate) {
            const original = acmeClient.createOrder.bind(acmeClient)
            acmeClient.createOrder = order => original({
                ...order, // acme-client auto() hardcodes every order identifier as DNS and cannot select the profile required for IP certificates
                profile: 'shortlived',
                identifiers: order.identifiers.map(({ value }) => ({ value, type: isIP(value) ? 'ip' : 'dns' }))
            } as any) // profile key is not declared in types, but is needed for letsencrypt
        }
        acme.setLogger(console.debug)
        const [key, csr] = await acme.crypto.createCsr({
            commonName: isIP(domain) ? undefined : domain, // rejected because Boulder doesn't accept IP addresses in the Common Name
            altNames: names,
        })
        const cert = await acmeClient.auto({
            csr,
            email,
            challengePriority: [method],
            skipChallengeVerification: true, // on NAT, trying to connect to your external ip will likely get your modem instead of the challenge server
            termsOfServiceAgreed: true,
            async challengeCreateFn(auth, challenge, value) {
                if (challenge.type !== method) throw Error("Unsupported ACME challenge")
                if (method === 'http-01') {
                    acmeTokens[challenge.token] = value
                }
                else {
                    progress("Creating DNS TXT record", auth.identifier.value)
                    const record = await dnsChallengeRecord(auth.identifier.value, value, resolver)
                    cleanups.set(challenge.token, await provider!.present(record, config!.credentials))
                    progress("Waiting for DNS propagation", auth.identifier.value)
                    await waitForDnsRecord(record, resolver, provider!.propagation_timeout === undefined ? undefined : provider!.propagation_timeout * 1000)
                }
                progress("Validating domain", auth.identifier.value)
            },
            async challengeRemoveFn(_, challenge) {
                delete acmeTokens[challenge.token]
                const cleanup = cleanups.get(challenge.token)
                if (cleanup) {
                    cleanups.delete(challenge.token)
                    // acme-client suppresses cleanup errors, so keep them visible in the final status
                    try { await cleanup() }
                    catch { cleanupErrors.push("Could not remove a DNS challenge TXT record") }
                }
            },
        })
        console.log("ACME certificate generated")
        return { key, cert, warning: cleanupErrors.join("; ") || undefined }
    }
    catch (error) {
        if (method === 'http-01' && error instanceof Error) {
            if (error.message.includes('Timeout')) error = Error("ensure your router is forwarding port 80 correctly")
            else if (error.message.includes('not match this challenge')) error = Error("a different server is responding on port 80 of your domain(s)")
        }
        if (cleanupErrors.length) throw Error(`${error instanceof Error ? error.message : error}; ${cleanupErrors.join('; ')}`)
        throw error
    }
    finally {
        if (tempMap && upnpEnabled.get()) {
            console.debug("Removing temporary port forward")
            getUpnpClient().removeMapping(TEMP_MAP).catch(() => {}) // clean after ourselves
        }
        acmeOngoing = false
        if (tempSrv?.listening) await new Promise<void>(res => tempSrv!.close(() => res()))
        console.debug('ACME terminated')
    }
}

export interface AcmeStatus {
    id: number
    state: 'idle' | 'running' | 'done' | 'error'
    message: string
    domain?: string
    warning?: string
}
let acmeStatus: AcmeStatus = { id: 0, state: 'idle', message: '' }
export function getAcmeStatus() { return acmeStatus }
function progress(message: string, domain?: string) {
    acmeStatus = { ...acmeStatus, message, domain }
    events.emit('acmeStatus', acmeStatus)
}
export function getAcmeStatusEvents() {
    let off: (() => void) | undefined
    return new Readable({
        objectMode: true,
        read() {
            if (off) return
            off = events.on('acmeStatus', status => this.push(status))
            this.once('close', off)
            this.push(acmeStatus)
        },
    })
}
export async function makeCert(domain: string, email?: string, altNames: string[] = []) {
    if (acmeStatus.state === 'running') throw Error("Certificate request already running")
    acmeStatus = { id: acmeStatus.id + 1, state: 'running', message: '' }
    progress("Starting certificate request")
    try {
        const names = certificateNames([domain, ...altNames])
        const res = await generateSSLCert(names, email)
        progress("Installing certificate")
        const CERT_FILE = 'acme.cer'
        const KEY_FILE = 'acme.key'
        await fs.writeFile(KEY_FILE, res.key, { mode: 0o600 })
        await fs.writeFile(CERT_FILE, res.cert)
        cert.set(CERT_FILE)
        privateKey.set(KEY_FILE)
        acmeRenewError = ''
        acmeStatus = { ...acmeStatus, state: 'done', warning: res.warning }
        progress("Certificate created")
    }
    catch (error) {
        acmeStatus = { ...acmeStatus, state: 'error' }
        progress(error instanceof Error ? error.message : String(error))
        throw error
    }
}

export let acmeRenewError = ''
events.once('httpsReady', () => repeat(HOUR, renewCert))

// checks if the cert is near expiration date, and if so renews it
const renewCert = debounceAsync(async () => {
    const [domain, ...altNames] = acmeDomain.get().split(',')
    if (!acmeRenew.get() || !domain) return
    const cert = getCertObject()
    if (!cert) return
    const now = new Date()
    const validFrom = new Date(cert.validFrom)
    const validTo = new Date(cert.validTo)
    // renew during the final third, adapting automatically to short-lived certificates
    const renewBefore = (validTo.getTime() - validFrom.getTime()) / 3
    if (now > validFrom && now < validTo && validTo.getTime() - now.getTime() >= renewBefore)
        return console.log("Certificate still good")
    await makeCert(domain, undefined, altNames)
        .catch(e => console.log(acmeRenewError = `Error renewing certificate, expiring ${formatDate(validTo)}: ${String(e.message || e)}`))
}, { retain: HOUR }) // short-lived certificates leave a renew window of just 2 days, and a failed renew is retained as a success here

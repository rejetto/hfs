import { DAY, Dict, haveTimeout, HOUR, HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_OK, MINUTE, repeat } from './misc'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Middleware } from 'koa'
import { getNatInfo, upnpClient } from './nat'
import { cert, getCertObject, getServerStatus, privateKey } from './listen'
import { ApiError } from './apiMiddleware'
import acme from 'acme-client'
import { debounceAsync } from './debounceAsync'
import fs from 'fs/promises'
import { defineConfig } from './config'
import events from './events'
import { selfCheck } from './selfCheck'

let acmeOngoing = false
const acmeTokens: Dict<string> = {}
const acmeListener = (req: IncomingMessage, res: ServerResponse) => { // node listener
    const BASE = '/.well-known/acme-challenge/'
    if (!req.url?.startsWith(BASE)) return
    const token = req.url.slice(BASE.length)
    console.debug("got http challenge", token)
    res.statusCode = HTTP_OK
    res.end(acmeTokens[token])
    return true // true = responded
}
export const acmeMiddleware: Middleware = (ctx, next) => { // koa format
    if (!acmeOngoing || !acmeListener(ctx.req, ctx.res))
        return next()
}

const TEMP_MAP = { private: 80, public: { host: '', port: 80 }, description: 'hfs temporary', ttl: 5000 } // from my tests (zyxel VMG8825), lower values won't make a working mapping

repeat(MINUTE, async stop => {
    await upnpClient.getGateway() // without this, the next call will break upnp support
    const res = await upnpClient.getMappings()
    const leftover = res.find(x => x.description === TEMP_MAP.description) // in case the process is interrupted
    if (!leftover) return void stop() // we are good
    if (acmeOngoing) return // it doesn't count, as we are in the middle of something. Retry later
    stop()
    return upnpClient.removeMapping(TEMP_MAP)
})

async function generateSSLCert(domain: string, email?: string, altNames?: string[]) {
    // will answer challenge through our koa app (if on port 80) or must we spawn a dedicated server?
    const nat = await getNatInfo()
    const { http } = await getServerStatus()
    const tempSrv = nat.externalPort === 80 || http.listening && http.port === 80 ? undefined
        : createServer((req, res) => acmeListener(req, res) || res.end('HFS')) // also satisfy self-check
    if (tempSrv)
        await new Promise<void>(resolve =>
            tempSrv.listen(80, resolve).on('error', (e: any) => {
                console.debug("cannot listen on 80", e.code || e)
                resolve() // go on anyway
            }) )
    acmeOngoing = true
    console.debug("acme challenge server ready")
    let tempMap: any
    try {
        const checkUrl = `http://${domain.split(',')[0]}`
        let check = await selfCheck(checkUrl) // some check services may not consider the domain, but we already verified that
        if (check?.success === false && nat.upnp && !nat.mapped80) {
            console.debug("setting temporary port forward")
            tempMap = await haveTimeout(10_000, upnpClient.createMapping(TEMP_MAP).catch(() => {})).catch(() => {})
            check = await selfCheck(checkUrl) // repeat test
        }
        //if (!check) throw new ApiError(HTTP_FAILED_DEPENDENCY, "couldn't test port 80")
        if (check?.success === false)
            throw new ApiError(HTTP_FAILED_DEPENDENCY, "port 80 is not working on the specified domain")
        const acmeClient = new acme.Client({
            accountKey: await acme.crypto.createPrivateKey(),
            directoryUrl: acme.directory.letsencrypt.production
        })
        acme.setLogger(console.debug)
        const [key, csr] = await acme.crypto.createCsr({ commonName: domain, altNames })
        const cert = await acmeClient.auto({
            csr,
            email,
            challengePriority: ['http-01'],
            skipChallengeVerification: true, // on NAT, trying to connect to your external ip will likely get your modem instead of the challenge server
            termsOfServiceAgreed: true,
            async challengeCreateFn(_, c, ka) { acmeTokens[c.token] = ka },
            async challengeRemoveFn(_, c) { delete acmeTokens[c.token] },
        })
        console.log("acme certificate generated")
        return { key, cert }
    }
    finally {
        if (tempMap) {
            console.debug("removing temporary port forward")
            upnpClient.removeMapping(TEMP_MAP).catch(() => {}) // clean after ourselves
        }
        acmeOngoing = false
        if (tempSrv) await new Promise(res => tempSrv.close(res))
        console.debug('acme terminated')
    }
}

export const makeCert = debounceAsync(async (domain: string, email?: string, altNames?: string[]) => {
    if (!domain) return new ApiError(HTTP_BAD_REQUEST, 'bad params')
    const res = await generateSSLCert(domain, email, altNames).catch(e => {
        throw !e.message?.includes('not match this challenge') ? e // another acme server?
            : Error("a different server is responding on port 80 of your domain(s)")
    })
    const CERT_FILE = 'acme.cer'
    const KEY_FILE = 'acme.key'
    await fs.writeFile(CERT_FILE, res.cert)
    await fs.writeFile(KEY_FILE, res.key)
    cert.set(CERT_FILE) // update config
    privateKey.set(KEY_FILE)
    acmeRenewError = ''
})

export let acmeRenewError = ''
const acmeDomain = defineConfig('acme_domain', '')
const acmeRenew = defineConfig('acme_renew', false) // handle config changes
events.once('httpsReady', () => repeat(HOUR, renewCert))

// checks if the cert is near expiration date, and if so renews it
const renewCert = debounceAsync(async () => {
    const [domain, ...altNames] = acmeDomain.get().split(',')
    if (!acmeRenew.get() || !domain) return
    const cert = getCertObject()
    if (!cert) return
    const now = new Date()
    const validTo = new Date(cert.validTo)
    // not expiring in a month
    if (now > new Date(cert.validFrom) && now < validTo && validTo.getTime() - now.getTime() >= 30 * DAY)
        return console.log("certificate still good")
    await makeCert(domain, undefined, altNames)
        .catch(e => console.log(acmeRenewError = `Error renewing certificate, expiring ${validTo.toLocaleDateString()}: ${String(e.message || e)}`))
}, { retain: DAY, retainFailure: HOUR })


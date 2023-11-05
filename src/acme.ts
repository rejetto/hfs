import { DAY, Dict, HOUR, HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_OK, repeat } from './cross'
import { createServer, RequestListener } from 'http'
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

async function generateSSLCert(domain: string, email?: string) {
    // will answer challenge through our koa app (if on port 80) or must we spawn a dedicated server?
    const nat = await getNatInfo()
    const { http } = await getServerStatus()
    const tempSrv = nat.externalPort === 80 || http.listening && http.port === 80 ? undefined : createServer(acmeListener)
    if (tempSrv)
        await new Promise<void>(resolve =>
            tempSrv.listen(80, resolve).on('error', (e: any) => {
                console.debug("cannot listen on 80", e.code || e)
                resolve() // go on anyway
            }) )
    acmeMiddlewareEnabled = true
    console.debug('acme challenge server ready')
    let tempMap: any
    try {
        const checkUrl = `http://${domain}`
        let check = await selfCheck(checkUrl) // some check services may not consider the domain, but we already verified that
        if (check && !check.success && nat.upnp && !nat.mapped80) {
            console.debug("setting temporary port forward")
            tempMap = await upnpClient.createMapping({ private: 80, public: { host: '', port: 80 }, description: 'hfs temporary', ttl: 0 }).catch(() => {})
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
            async challengeCreateFn(_, c, ka) { acmeTokens[c.token] = ka },
            async challengeRemoveFn(_, c) { delete acmeTokens[c.token] },
        })
        return { key, cert }
    }
    finally {
        if (tempMap) {
            console.debug("removing temporary port forward")
            upnpClient.removeMapping({ public: { host: '', port: 80 } }).catch(() => {})
        }
        acmeMiddlewareEnabled = false
        if (tempSrv) await new Promise(res => tempSrv.close(res))
        console.debug('acme terminated')
    }
}

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

const acmeDomain = defineConfig('acme_domain', '')
const acmeEmail = defineConfig('acme_email', '')
const acmeRenew = defineConfig('acme_renew', false) // handle config changes
events.once('https ready', () => repeat(HOUR, renewCert))

// checks if the cert is near expiration date, and if so renews it
const renewCert = debounceAsync(async () => {
    if (!acmeRenew.get()) return
    const cert = getCertObject()
    if (!cert) return
    const now = new Date()
    const validTo = new Date(cert.validTo)
    // not expiring in a month
    if (now > new Date(cert.validFrom) && now < validTo && validTo.getTime() - now.getTime() >= 30 * DAY)
        return console.log("certificate still good")
    await makeCert(acmeDomain.get(), acmeEmail.get())
        .catch(e => console.log("error renewing certificate: ", String(e)))
}, 0, { retain: DAY, retainFailure: HOUR })


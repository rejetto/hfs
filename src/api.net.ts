// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'
import { HTTP_BAD_REQUEST, HTTP_FAILED_DEPENDENCY, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE, IS_MAC, IS_WINDOWS } from './const'
import axios from 'axios'
import {parse} from 'node-html-parser'
import _ from 'lodash'
import { cert, getIps, getServerStatus, privateKey, startServer, stopServer } from './listen'
import { getProjectInfo } from './github'
import { httpString } from './util-http'
import { exec } from 'child_process'
import { debounceAsync, findDefined, HOUR, MINUTE, repeat, Dict } from './misc'
import acme from 'acme-client'
import fs from 'fs/promises'
import { createServer } from 'http'

const client = new Client({ timeout: 4_000 })
const originalMethod = client.getGateway
// other client methods call getGateway too, so this will ensure they reuse this same result
client.getGateway = debounceAsync(() => originalMethod.apply(client), 0, { retain: HOUR, retainFailure: 30_000 })
client.getGateway().catch(() => {})

export let externalIp = Promise.resolve('') // poll external ip
repeat(10 * MINUTE, () => {
    const was = externalIp
    externalIp = client.getPublicIp().catch(() => was) //fallback to previous value
})

const getNatInfo = debounceAsync(async () => {
    const gettingIp = getPublicIp() // don't wait, do it in parallel
    const res = await client.getGateway().catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await client.getMappings().catch(() => null)
    console.debug('mappings found', mappings)
    const gatewayIp = res ? new URL(res.gateway.description).hostname : await findGateway().catch(() => null)
    const localIp = res?.address || (await getIps())[0]
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort)
    console.debug('responding')
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

async function generateSSLCert(domain: string, email?: string) {
    const acmeTokens: Dict<string> = {}
    // create temporary server to answer the challenge
    const BASE = '/.well-known/acme-challenge/'
    const srv = createServer((req, res) => {
        const token = req.url?.startsWith(BASE) && req.url.slice(BASE.length) || ''
        console.debug("got http challenge", token || req.url)
        res.end(acmeTokens[token])
    })
    await new Promise<void>((resolve, reject) =>
        srv.listen(80, resolve).on('error', (e: any) => reject(e.code || e)) )
    console.debug('acme challenge server ready')
    try {
        const client = new acme.Client({
            accountKey: await acme.crypto.createPrivateKey(),
            directoryUrl: acme.directory.letsencrypt.production
        })
        const [key, csr] = await acme.crypto.createCsr({ commonName: domain })
        const cert = await client.auto({
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
        await new Promise(res => srv.close(res))
        console.debug('acme terminated')
    }
}

const apis: ApiHandlers = {
    get_nat: getNatInfo,

    async map_port({ external }) {
        const { gatewayIp, externalPort, internalPort } = await getNatInfo()
        if (!gatewayIp)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'upnp failed')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        if (externalPort)
            try { await client.removeMapping({ public: { host: '', port: externalPort } }) }
            catch (e: any) { return new ApiError(HTTP_SERVER_ERROR, 'removeMapping failed: ' + String(e) ) }
        if (external) // must use the object form of 'public' to workaround a bug of the library
            await client.createMapping({ private: internalPort, public: { host: '', port: external }, description: 'hfs', ttl: 0 })
        return {}
    },

    async check_server() {
        const { publicIp, internalPort, externalPort } = await getNatInfo()
        if (!publicIp)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'cannot detect public ip')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        const prjInfo = await getProjectInfo()
        const port = externalPort || internalPort
        console.log(`checking server ${publicIp}:${port}`)
        interface PortScannerService {
            url: string
            headers: {[k: string]: string}
            method: string
            selector: string
            body?: string
            regexpFailure: string
            regexpSuccess: string
        }
        for (const services of _.chunk(_.shuffle<PortScannerService>(prjInfo.checkServerServices), 2)) {
            try {
                return Promise.any(services.map(async svc => {
                    const service = new URL(svc.url).hostname
                    console.log('trying service', service)
                    const api = (axios as any)[svc.method]
                    const body = svc.body?.replace('$IP', publicIp).replace('$PORT', String(port)) || ''
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
        return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'no service available to detect upnp mapping')
    },

    async make_cert({email, domain}) {
        if (!domain) return new ApiError(HTTP_BAD_REQUEST, 'bad params')
        const { externalPort } = await getNatInfo() // do this before stopping the server
        if (externalPort !== 80)
            await client.createMapping({ private: 80, public: { host: '', port: 80 }, description: 'hfs challenge', ttl: 0 }).catch(() => {})
        // we could have a server on port 80 already. With upnp it should be easy to forward to a different internal port and workaround the conflict, but we could as well be on a VPS with public ip and no forwarding at all
        // therefore the catch-all solution is to temporarily disable the server on 80, without changing configuration, to avoid persisting if we crash in the middle
        const restore = findDefined(await getServerStatus(), x => {
            if (!x.listening || x.port !== 80) return
            stopServer(x.srv)
            return () => startServer(x.srv, { port: x.configuredPort }) // return a callback to restore the server
        })
        try {
            // if possible, create a short-lived mapping
            const res = await generateSSLCert(domain, email)
            const SUFFIX = '-acme.pem'
            const CERT_FILE = 'cert' + SUFFIX
            const KEY_FILE = 'key' + SUFFIX
            await fs.writeFile(CERT_FILE, res.cert)
            await fs.writeFile(KEY_FILE, res.key)
            cert.set(CERT_FILE) // update config
            privateKey.set(KEY_FILE)
            return {}
        }
        catch (e:any) { //TODO if this request was made on port 80, this reply will never be received because the server was shut down. Possible solution: GUI could ask for outcome on the temporary server
            console.log(e?.message || String(e))
            return new ApiError(HTTP_FAILED_DEPENDENCY, String(e))
        }
        finally { await restore?.() }
    },
}

export default apis
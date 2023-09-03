// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'
import { HTTP_FAILED_DEPENDENCY, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE, IS_MAC, IS_WINDOWS } from './const'
import axios from 'axios'
import {parse} from 'node-html-parser'
import _ from 'lodash'
import { getIps, getServerStatus } from './listen'
import { getProjectInfo } from './github'
import { httpString } from './util-http'
import { exec } from 'child_process'
import { debounceAsync } from './misc'

const client = new Client({ timeout: 5_000 })
const original = client.getGateway
client.getGateway = () => {
    const promise = original.apply(client)
    promise.then(() => { // store in cache only if successful
        console.debug('caching gateway')
        // other client methods call getGateway too, so this will ensure they reuse this same result
        client.getGateway = () => promise
    }, ()=>{})
    return promise
}
client.getGateway()

const getNatInfo = debounceAsync(async () => {
    const gettingIp = getPublicIp() // don't wait, do it in parallel
    const res = await client.getGateway().catch(() => null)
    const status = await getServerStatus()
    const mappings = res && await client.getMappings().catch(() => null)
    console.debug('mappings found', mappings)
    const externalIp = res && await client.getPublicIp().catch(() => null)
    const gatewayIp = res ? new URL(res.gateway.description).hostname : await getGateway().catch(() => null)
    const localIp = res?.address || getIps()[0]
    const internalPort = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port
    const mapped = _.find(mappings, x => x.private.host === localIp && x.private.port === internalPort || x.description === 'hfs')
    console.debug('responding')
    return {
        upnp: Boolean(res),
        localIp,
        gatewayIp,
        publicIp: await gettingIp || externalIp,
        externalIp,
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

function getGateway(): Promise<string | undefined> {
    return new Promise((resolve, reject) =>
        exec(IS_WINDOWS || IS_MAC ? 'netstat -rn' : 'route -n', (err, out) => {
            if (err) return reject(err)
            const re = IS_WINDOWS ? /(?:0\.0\.0\.0 +){2}([\d.]+)/ : IS_MAC ? /default +([\d.]+)/ : /^0\.0\.0\.0 +([\d.]+)/
            resolve(re.exec(out)?.[1])
        }) )
}

const apis: ApiHandlers = {
    get_nat: getNatInfo,

    async map_port({ external }) {
        const { gatewayIp, mapped, internalPort } = await getNatInfo()
        if (!gatewayIp)
            return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'upnp failed')
        if (!internalPort)
            return new ApiError(HTTP_FAILED_DEPENDENCY, 'no internal port')
        if (mapped)
            try { await client.removeMapping({ public: { host: '', port: mapped.public.port } }) }
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

}

export default apis
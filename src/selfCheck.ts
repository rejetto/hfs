import { SPECIAL_URI } from './cross-const'
import { Middleware } from 'koa'
import { getProjectInfo } from './github'
import { isIP, isIPv6 } from 'net'
import _ from 'lodash'
import { haveTimeout } from './cross'
import { httpString } from './util-http'

let selfCheckMiddlewareEnabled = false
const CHECK_URL = SPECIAL_URI + 'self-check'
export const selfCheckMiddleware: Middleware = (ctx, next) => { // koa format
    if (!selfCheckMiddlewareEnabled || !ctx.url.startsWith(CHECK_URL))
        return next()
    ctx.body = 'HFS'
}

export async function selfCheck(url: string) {
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
        for (const services of _.chunk(_.shuffle<PortScannerService>(prjInfo.selfCheckServices), 2)) {
            try {
                return await Promise.any(services.map(async (svc) => {
                    if (!svc.url || svc.type) throw 'unsupported ' + svc.type // only default type supported for now
                    let { url: serviceUrl, body, regexpSuccess, regexpFailure, ...rest } = svc
                    const service = new URL(serviceUrl).hostname
                    console.log('trying external service', service)
                    body = applySymbols(body)
                    serviceUrl = applySymbols(serviceUrl)!
                    const res = await haveTimeout(6_000, httpString(serviceUrl, { family, ...rest, body }))
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

import { SPECIAL_URI } from './cross-const'
import { Middleware } from 'koa'
import { getProjectInfo } from './github'
import { isIP, isIPv6 } from 'net'
import _ from 'lodash'
import { findDefined, haveTimeout, normalizeHost } from './cross'
import { httpString } from './util-http'

let activeSelfChecks = 0

const CHECK_URL = SPECIAL_URI + 'self-check'
export const selfCheckMiddleware: Middleware = (ctx, next) => {
    if (!activeSelfChecks || !ctx.url.startsWith(CHECK_URL))
        return next()
    ctx.body = 'HFS'
    ctx.state.skipFilters = true
}

declare module "koa" {
    interface DefaultState {
        skipFilters?: boolean
    }
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
    console.log(`Checking server ${url}`)
    const parsed = new URL(url)
    const hostname = normalizeHost(parsed.hostname)
    const family = !isIP(hostname) ? undefined : isIPv6(hostname) ? 6 : 4
    try {
        ++activeSelfChecks
        for (const services of _.chunk(_.shuffle<PortScannerService>(prjInfo.selfCheckServices), 2)) {
            try {
                const results = await Promise.allSettled(services.map(async svc => {
                    if (!svc.url || svc.type) throw 'unsupported ' + svc.type // only default type supported for now
                    let { url: serviceUrl, body, regexpSuccess, regexpFailure, ...rest } = svc
                    const service = new URL(serviceUrl).hostname
                    console.log('Trying external service', service)
                    console.debug(svc)
                    body = applySymbols(body)
                    serviceUrl = applySymbols(serviceUrl)!
                    const timeout = 8_000
                    const res = await haveTimeout(timeout, httpString(serviceUrl, { family, timeout, ...rest, body }))
                    const success = new RegExp(regexpSuccess).test(res)
                    const failure = new RegExp(regexpFailure).test(res)
                    if (success === failure) throw 'inconsistent: ' + service + ': ' + res // this result cannot be trusted
                    console.debug(service, 'responded', success)
                    return { success, service, url }
                }))
                // prefer a positive check so a fast false negative doesn't mask a working service
                return findDefined(results, x => x.status === 'fulfilled' && x.value.success ? x.value : undefined)
                    || findDefined(results, x => x.status === 'fulfilled' ? x.value : undefined)
            }
            catch (e: any) {
                console.debug(e?.errors?.map(String) || e?.cause || String(e))
            }
        }
    }
    finally {
        --activeSelfChecks
    }

    function applySymbols(s?: string) {
        return s?.replace('$IP', hostname)
            .replace('$PORT', parsed.port || (parsed.protocol === 'https:' ? '443' : '80'))
            .replace('$URL', url.replace(/\/$/, '') + CHECK_URL)
    }
}

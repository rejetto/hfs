// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { HTTP_FAILED_DEPENDENCY, HTTP_SERVER_ERROR, HTTP_SERVICE_UNAVAILABLE, HTTP_PRECONDITION_FAILED, HTTP_NOT_FOUND
} from './const'
import _ from 'lodash'
import { getCertObject } from './listen'
import { getProjectInfo } from './github'
import { apiAssertTypes, onlyTruthy, promiseBestEffort } from './misc'
import { lookup, Resolver } from 'dns/promises'
import { isIPv6 } from 'net'
import { getNatInfo, getPublicIps, upnpClient } from './nat'
import { makeCert } from './acme'
import { selfCheck } from './selfCheck'

const apis: ApiHandlers = {
    get_nat: getNatInfo,

    async check_domain({ domain }) {
        apiAssertTypes({ string: domain })
        const resolver = new Resolver()
        const prjInfo = await getProjectInfo()
        resolver.setServers(prjInfo.dnsServers)
        const settled = await Promise.allSettled([
            resolver.resolve(domain, 'A'),
            resolver.resolve(domain, 'AAAA'),
            lookup(domain).then(x => [x.address]),
        ])
        if (settled[0].status === 'rejected' && settled[0].reason.code === 'ECONNREFUSED')
            throw new ApiError(HTTP_SERVICE_UNAVAILABLE, "cannot resolve domain")
        // merge all results
        const domainIps = _.uniq(onlyTruthy(settled.map(x => x.status === 'fulfilled' && x.value)).flat())
        if (!domainIps.length)
            throw new ApiError(HTTP_FAILED_DEPENDENCY, "domain not working")
        const publicIps = await getPublicIps() // do this before stopping the server
        for (const v6 of [false, true]) {
            const domainIpsThisVersion = domainIps.filter(x => isIPv6(x) === v6)
            const ipsThisVersion = publicIps.filter(x => isIPv6(x) === v6)
            if (domainIpsThisVersion.length && ipsThisVersion.length && !_.intersection(domainIpsThisVersion, ipsThisVersion).length)
                throw new ApiError(HTTP_PRECONDITION_FAILED, `configure your domain to point to ${ipsThisVersion} (currently on ${domainIpsThisVersion[0]}) – a change can take hours to be effective`)
        }
        return {}
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

    async make_cert({domain, email, altNames}) {
        await makeCert(domain, email, altNames)
        return {}
    },

    get_cert() {
        return getCertObject() || { none: true }
    }
}

export default apis
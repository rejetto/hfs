// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'
import { HTTP_SERVICE_UNAVAILABLE, HTTP_SERVER_ERROR } from './const'
import axios from 'axios'
import {parse} from 'node-html-parser'
import _ from 'lodash'
import { getServerStatus } from './listen'
import { getProjectInfo } from './github'

export interface PortScannerService {
    url: string
    headers: {[k: string]: any}
    method: string
    selector: string
    body?: string
    regexpFailure: string
    regexpSuccess: string
}

async function get_nat() {
    const client = new Client()
    const { gateway, address} = await client.getGateway().catch(() => {
        throw new ApiError(HTTP_SERVICE_UNAVAILABLE, 'upnp failed')
    })
    const status = await getServerStatus()
    const port = status?.https?.listening && status.https.port || status?.http?.listening && status.http.port
    const mappings = await client.getMappings().catch(() => null)
    const mapped = _.find(mappings, x => x.private.host === address && x.private.port === port || x.description === 'hfs')
    return {
        local_ip: address,
        gateway_ip: new URL(gateway.description).hostname,
        public_ip: await client.getPublicIp().catch(() => null),
        mapped,
        mappings,
        port,
    }
}

const apis: ApiHandlers = {
    get_nat,

    async map_port({ external }) {
        const { mapped, port } = await get_nat()
        const client = new Client()
        if (mapped)
            await client.removeMapping({ private: mapped.private.port, public: mapped.public.port, protocol: 'tcp' })
        if (external)
            await client.createMapping({ private: port, public: external, description: 'hfs', ttl: 0 })
        return {}
    },

    async check_server() {
        const noop = () => null
        const client = new Client()
        const publicIp = await client.getPublicIp().catch(noop)
        if (!publicIp) return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'cannot detect public ip')
        const {http, https} = await getServerStatus()
        const port = https.port > 0 ? https.port : http.port
        const prjInfo = await getProjectInfo()
        for (const svc of _.shuffle<PortScannerService>(prjInfo.checkServerServices)) {
            const api = (axios as any)[svc.method]
            const body = svc.body?.replace('$IP', publicIp).replace('$PORT', port) || ''
            const res = await api(svc.url, body, {headers: svc.headers}).catch(noop)
            if (!res) continue
            const parsed = parse(res.data).querySelector(svc.selector)?.innerText
            if (!parsed) continue
            const success = new RegExp(svc.regexpSuccess).test(parsed)
            const failure = new RegExp(svc.regexpFailure).test(parsed)
            if (success === failure) continue // this result cannot be trusted
            const service = new URL(svc.url).hostname
            return { success, service }
        }
        return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'no service available to detect upnp mapping')
    },

}

export default apis
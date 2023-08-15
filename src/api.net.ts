// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiError, ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'
import { HTTP_SERVICE_UNAVAILABLE } from './const'
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

const apis: ApiHandlers = {

    async get_nat() {
        const client = new Client()
        const { gateway, address} = await client.getGateway()
        return {
            local_ip: address,
            gateway_ip: new URL(gateway.description).hostname,
            public_ip: await client.getPublicIp()
        }
    },

    async check_server() {
        const noop = () => null;
        const client = new Client()
        const publicIp = await client.getPublicIp().catch(noop)
        if (publicIp === null) return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'cannot detect public ip')
        const {http, https} = await getServerStatus()
        const port = https.port > 0 ? https.port : http.port
        const prjInfo = await getProjectInfo()
        for (const svc of _.shuffle<PortScannerService>(prjInfo.checkServerServices)) {
            const api = (axios as any)[svc.method.toLowerCase()]
            const body = (svc.body || "")
                .replace('$IP', publicIp)
                .replace('$PORT', port)
            const res = await api(svc.url, body, {headers: svc.headers}).catch(noop)
            if (res == null) continue
            const parsed = parse(res.data).querySelector(svc.selector)?.innerText
            if (!parsed) continue
            const result = new RegExp(svc.regexpSuccess).test(parsed)
            const ftest = new RegExp(svc.regexpFailure).test(parsed)
            if (result === ftest) continue;
            const service = new URL(svc.url).hostname
            return {result, service}
        }
        return new ApiError(HTTP_SERVICE_UNAVAILABLE, 'no service available to detect upnp mapping')
    }

}

export default apis
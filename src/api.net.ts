// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { ApiHandlers } from './apiMiddleware'
import { Client } from 'nat-upnp'

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

}

export default apis